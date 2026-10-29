use super::{store, tools, types::*, McpService};
use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::Response,
    Router,
};
use rmcp::{model::*, service::RequestContext, ErrorData, RoleServer, ServerHandler};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct Principal(pub McpClient);
#[derive(Clone)]
struct Handler {
    app: AppHandle,
}
#[derive(Clone)]
struct AuthState {
    app: AppHandle,
    port: u16,
}
fn principal(context: &RequestContext<RoleServer>) -> std::result::Result<McpClient, ErrorData> {
    context
        .extensions
        .get::<axum::http::request::Parts>()
        .and_then(|p| p.extensions.get::<Principal>())
        .map(|p| p.0.clone())
        .ok_or_else(|| ErrorData::invalid_request("Authentication required", None))
}
impl ServerHandler for Handler {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build()).with_instructions("Projects Runner desktop app. Access is controlled per client. Unlock the 2FA vault in the app before requesting an OTP. Sync reviews are completed in the app.")
    }
    async fn list_tools(
        &self,
        _: Option<PaginatedRequestParams>,
        ctx: RequestContext<RoleServer>,
    ) -> std::result::Result<ListToolsResult, ErrorData> {
        let c = principal(&ctx)?;
        let app = self.app.clone();
        let list = tauri::async_runtime::spawn_blocking(move || {
            let state = app.state::<crate::AppState>();
            super::policy::refresh(&state.paths, &c).map(|c| {
                tools::definitions()
                    .into_iter()
                    .filter(|t| super::policy::permission(&c, tools::permission(&t.name)).is_ok())
                    .collect::<Vec<_>>()
            })
        })
        .await
        .map_err(|_| ErrorData::internal_error("Worker failed", None))?
        .map_err(|_| ErrorData::invalid_request("Access revoked", None))?;
        let mut result = ListToolsResult::default();
        result.tools = list;
        Ok(result)
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        ctx: RequestContext<RoleServer>,
    ) -> std::result::Result<CallToolResponse, ErrorData> {
        let c = principal(&ctx)?;
        let name = request.name.to_string();
        let args = serde_json::Value::Object(request.arguments.unwrap_or_default());
        let sem = {
            let service = self.app.state::<McpService>();
            let mut map = service.limits.lock().unwrap();
            map.entry(c.id.clone())
                .or_insert_with(|| Arc::new(tokio::sync::Semaphore::new(8)))
                .clone()
        };
        let Ok(permit) = sem.try_acquire_owned() else {
            return Ok(CallToolResult::structured_error(
                serde_json::json!({"code":"BUSY","message":"Too many concurrent calls."}),
            )
            .into());
        };
        let app = self.app.clone();
        let started = std::time::Instant::now();
        let result = tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            let state = app.state::<crate::AppState>();
            let r = super::policy::refresh(&state.paths, &c).and_then(|c| {
                super::policy::permission(&c, tools::permission(&name))?;
                tools::execute(&app, &c, &name, args.clone())
            });
            let target = args
                .get("project_id")
                .or_else(|| args.get("command_id"))
                .or_else(|| args.get("run_id"))
                .and_then(|v| v.as_i64())
                .map(|v| v.to_string())
                .or_else(|| {
                    args.get("account_id")
                        .and_then(|v| v.as_str())
                        .filter(|v| uuid::Uuid::parse_str(v).is_ok())
                        .map(str::to_string)
                });
            store::activity(
                &state.paths,
                &c,
                if tools::permission(&name) == "__unknown" {
                    "unknown"
                } else {
                    &name
                },
                target,
                r.as_ref().err().map(|e| e.code.as_str()),
                started.elapsed().as_millis().min(i32::MAX as u128) as i32,
            );
            r
        })
        .await
        .map_err(|_| ErrorData::internal_error("Worker failed", None))?;
        Ok(match result {
            Ok(v) => CallToolResult::structured(v),
            Err(e) => CallToolResult::structured_error(serde_json::to_value(e).unwrap()),
        }
        .into())
    }
}
async fn auth(
    State(state): State<AuthState>,
    mut request: Request,
    next: Next,
) -> std::result::Result<Response, StatusCode> {
    let AuthState { app, port } = state;
    if !valid_authority(request.headers(), port) {
        return Err(StatusCode::FORBIDDEN);
    }
    let token = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?
        .to_string();
    let a = app.clone();
    let c = tauri::async_runtime::spawn_blocking(move || {
        store::authenticate(&a.state::<crate::AppState>().paths, &token)
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .map_err(|_| StatusCode::UNAUTHORIZED)?;
    request.extensions_mut().insert(Principal(c));
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        "cache-control",
        axum::http::HeaderValue::from_static("no-store"),
    );
    Ok(response)
}
fn valid_authority(headers: &axum::http::HeaderMap, port: u16) -> bool {
    let host = format!("127.0.0.1:{port}");
    headers.get("host").and_then(|v| v.to_str().ok()) == Some(host.as_str())
        && headers
            .get("origin")
            .is_none_or(|v| v.to_str().ok() == Some(format!("http://{host}").as_str()))
}
pub fn spawn(
    app: AppHandle,
    listener: tokio::net::TcpListener,
    port: u16,
    ct: CancellationToken,
) -> tauri::async_runtime::JoinHandle<()> {
    use rmcp::transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    };
    let factory_app = app.clone();
    let config = StreamableHttpServerConfig::default()
        .with_legacy_session_mode(false)
        .with_json_response(true)
        .with_cancellation_token(ct.clone())
        .with_max_request_body_bytes(2 * 1024 * 1024)
        .with_allowed_hosts(vec![format!("127.0.0.1:{port}")])
        .with_allowed_origins(vec![format!("http://127.0.0.1:{port}")]);
    let service = StreamableHttpService::new(
        move || {
            Ok(Handler {
                app: factory_app.clone(),
            })
        },
        Arc::new(LocalSessionManager::default()),
        config,
    );
    let router = Router::new()
        .nest_service("/mcp", service)
        .layer(middleware::from_fn_with_state(
            AuthState { app, port },
            auth,
        ));
    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(ct.cancelled_owned())
            .await;
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn localhost_authority_is_exact_and_origin_is_optional() {
        let mut headers = axum::http::HeaderMap::new();
        assert!(!valid_authority(&headers, 6811));
        headers.insert("host", "127.0.0.1:6811".parse().unwrap());
        assert!(valid_authority(&headers, 6811));
        headers.insert("origin", "https://attacker.example".parse().unwrap());
        assert!(!valid_authority(&headers, 6811));
        headers.insert("origin", "http://127.0.0.1:6811".parse().unwrap());
        assert!(valid_authority(&headers, 6811));
        headers.insert("host", "127.0.0.1.attacker.example:6811".parse().unwrap());
        assert!(!valid_authority(&headers, 6811));
    }
}
