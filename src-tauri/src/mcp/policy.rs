use super::{store, types::*};
use crate::AppPaths;
pub fn permission(c: &McpClient, p: &str) -> Result<()> {
    if c.enabled && c.permissions.iter().any(|v| v == p) {
        Ok(())
    } else {
        Err(McpError::new(
            "PERMISSION_DENIED",
            "This client does not have the required permission.",
        ))
    }
}
pub fn project(c: &McpClient, id: i64) -> Result<()> {
    if c.project_scope == "all" || c.project_ids.iter().any(|p| i64::from(*p) == id) {
        Ok(())
    } else {
        Err(McpError::new("NOT_FOUND", "Resource not found."))
    }
}
pub fn account(c: &McpClient, id: &str) -> Result<()> {
    if !id.is_empty() && c.account_ids.iter().any(|a| a == id) {
        Ok(())
    } else {
        Err(McpError::new("NOT_FOUND", "Account not found."))
    }
}
pub fn refresh(paths: &AppPaths, c: &McpClient) -> Result<McpClient> {
    let next = store::client(paths, &c.id)?;
    if !next.enabled || next.token_prefix != c.token_prefix {
        return Err(McpError::new(
            "PERMISSION_DENIED",
            "Client access was revoked.",
        ));
    }
    Ok(next)
}
