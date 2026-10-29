use rmcp::transport::{
    streamable_http_client::StreamableHttpClientTransportConfig, StreamableHttpClientTransport,
};
use rmcp::{
    model::*,
    service::{RequestContext, RunningService},
    ErrorData, RoleServer, ServerHandler, ServiceExt,
};

struct Bridge {
    config: StreamableHttpClientTransportConfig,
}
impl Bridge {
    async fn connect(&self) -> Result<RunningService<rmcp::RoleClient, ()>, ErrorData> {
        ().serve(StreamableHttpClientTransport::from_config(self.config.clone())).await.map_err(|_|ErrorData::internal_error("Cannot connect to Projects Runner. Open the app, enable MCP and check the client token.",None))
    }
}
impl ServerHandler for Bridge {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions("Projects Runner local bridge. The desktop app must be open.")
    }
    async fn list_tools(
        &self,
        request: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let remote = self.connect().await?;
        let result = remote.list_tools(request).await.map_err(|_| {
            ErrorData::internal_error(
                "Unable to list tools. Check the desktop app and client token.",
                None,
            )
        });
        let _ = remote.cancel().await;
        result
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let remote = self.connect().await?;
        let result = remote.call_tool(request).await;
        let _ = remote.cancel().await;
        match result {Ok(v)=>Ok(v.into()),Err(_)=>Ok(CallToolResult::structured_error(serde_json::json!({"code":"APP_UNAVAILABLE","message":"Connection failed. Check the app. Mutations are not automatically retried; inspect state before repeating."})).into())}
    }
}
#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let mut url = "http://127.0.0.1:6811/mcp".to_string();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--version" => {
                println!("projects-runner-mcp {}", env!("CARGO_PKG_VERSION"));
                return Ok(());
            }
            "--url" => url = args.next().ok_or("--url requires a value")?,
            _ => {
                return Err(
                    "Usage: projects-runner-mcp [--url http://127.0.0.1:PORT/mcp] [--version]"
                        .into(),
                )
            }
        }
    }
    let uri: axum::http::Uri = url.parse()?;
    if uri.scheme_str() != Some("http")
        || uri.host() != Some("127.0.0.1")
        || uri.path() != "/mcp"
        || uri.query().is_some()
    {
        return Err("Only an HTTP loopback /mcp endpoint is supported.".into());
    }
    let token = std::env::var("PROJECTS_RUNNER_MCP_TOKEN")
        .map_err(|_| "Set PROJECTS_RUNNER_MCP_TOKEN from Settings > MCP.")?;
    let config = StreamableHttpClientTransportConfig::with_uri(url)
        .auth_header(token)
        .reinit_on_expired_session(false);
    let service = Bridge { config }.serve(rmcp::transport::stdio()).await?;
    service.waiting().await?;
    Ok(())
}
