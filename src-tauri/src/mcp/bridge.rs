use super::types::McpBridgeInfo;
use tauri::{AppHandle, Manager};
fn same_file_contents(a: &std::path::Path, b: &std::path::Path) -> bool {
    use std::io::Read;
    if std::fs::metadata(a).ok().map(|m| m.len()) != std::fs::metadata(b).ok().map(|m| m.len()) {
        return false;
    }
    let (Ok(mut a), Ok(mut b)) = (std::fs::File::open(a), std::fs::File::open(b)) else {
        return false;
    };
    let mut left = [0u8; 65536];
    let mut right = [0u8; 65536];
    loop {
        let Ok(n) = a.read(&mut left) else {
            return false;
        };
        if b.read_exact(&mut right[..n]).is_err() || left[..n] != right[..n] {
            return false;
        }
        if n == 0 {
            return true;
        }
    }
}
#[cfg(windows)]
fn replace_file(source: &std::path::Path, target: &std::path::Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), 0x1 | 0x8) } == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}
#[cfg(not(windows))]
fn replace_file(source: &std::path::Path, target: &std::path::Path) -> std::io::Result<()> {
    std::fs::rename(source, target)
}
pub fn install(app: &AppHandle) -> McpBridgeInfo {
    let result = (|| -> std::result::Result<String, String> {
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        let name = format!("projects-runner-mcp{suffix}");
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let source = [
            exe.parent().unwrap().join(&name),
            app.path()
                .resource_dir()
                .map_err(|e| e.to_string())?
                .join(&name),
        ]
        .into_iter()
        .find(|p| p.is_file())
        .ok_or("Build the MCP bridge before generating stdio configuration.")?;
        let dir = app
            .path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .join("bin");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let target = dir.join(&name);
        if !same_file_contents(&source, &target) {
            let temp = dir.join(format!("{name}.{}.new", uuid::Uuid::new_v4()));
            std::fs::copy(&source, &temp).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(0o755))
                    .map_err(|e| e.to_string())?;
            }
            if let Err(e) = replace_file(&temp, &target) {
                let _ = std::fs::remove_file(&temp);
                if !target.is_file() {
                    return Err(e.to_string());
                }
            }
        }
        Ok(target.to_string_lossy().into_owned())
    })();
    McpBridgeInfo {
        path: result.as_ref().ok().cloned(),
        error: result.err(),
        version: env!("CARGO_PKG_VERSION").into(),
    }
}
