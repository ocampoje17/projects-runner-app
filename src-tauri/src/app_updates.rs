use futures_util::StreamExt;
use reqwest::header::{ACCEPT, USER_AGENT};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

const RELEASES_API_URL: &str =
    "https://api.github.com/repos/ocampoje17/projects-runner-app/releases/latest";
const DOWNLOAD_EVENT: &str = "update://download-progress";

pub struct UpdateState {
    pending: Mutex<Option<PendingUpdate>>,
    downloaded: Mutex<Option<DownloadedUpdate>>,
    downloading: Mutex<bool>,
}

impl Default for UpdateState {
    fn default() -> Self {
        Self {
            pending: Mutex::new(None),
            downloaded: Mutex::new(None),
            downloading: Mutex::new(false),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub version: String,
    pub asset_name: String,
    pub asset_size: u64,
    pub install_action: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub update: Option<UpdateInfo>,
}

#[derive(Debug, Clone)]
struct DownloadedUpdate {
    path: PathBuf,
    expected_sha256: String,
    install_action: String,
}

#[derive(Debug, Clone)]
struct PendingUpdate {
    info: UpdateInfo,
    url: String,
    sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "event",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum DownloadEvent {
    Started {
        total_bytes: u64,
    },
    Progress {
        downloaded_bytes: u64,
        total_bytes: u64,
    },
    Finished {
        path: String,
    },
    Failed {
        message: String,
    },
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    size: u64,
    browser_download_url: String,
    digest: Option<String>,
}

fn current_version() -> Result<Version, String> {
    Version::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|error| format!("Invalid app version: {error}"))
}

fn release_version(tag: &str) -> Result<Version, String> {
    let version = tag.strip_prefix("app-v").ok_or_else(|| {
        "Latest GitHub release does not use the required app-v<version> tag.".to_string()
    })?;
    Version::parse(version).map_err(|error| format!("Invalid release tag version: {error}"))
}

fn current_platform_asset<'a>(
    assets: &'a [GithubAsset],
) -> Option<(&'a GithubAsset, &'static str)> {
    #[cfg(target_os = "windows")]
    {
        return assets
            .iter()
            .find(|asset| asset.name.ends_with("_x64-setup.exe"))
            .map(|asset| (asset, "install"));
    }

    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("APPIMAGE").is_some() {
            return assets
                .iter()
                .find(|asset| asset.name.ends_with(".AppImage"))
                .map(|asset| (asset, "reveal"));
        }

        return assets
            .iter()
            .find(|asset| asset.name.ends_with(".deb"))
            .map(|asset| (asset, "reveal"));
    }

    #[cfg(target_os = "macos")]
    {
        return assets
            .iter()
            .find(|asset| asset.name.ends_with("_aarch64.dmg"))
            .map(|asset| (asset, "reveal"));
    }

    #[allow(unreachable_code)]
    None
}

fn normalize_sha256(digest: Option<&str>) -> Result<String, String> {
    let value = digest
        .unwrap_or_default()
        .strip_prefix("sha256:")
        .ok_or_else(|| "The GitHub release asset does not provide a SHA-256 digest.".to_string())?
        .to_ascii_lowercase();
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("The GitHub release returned an invalid SHA-256 digest.".to_string());
    }
    Ok(value)
}

fn update_download_directory(app: &AppHandle, version: &str) -> Result<PathBuf, String> {
    let downloads = app
        .path()
        .download_dir()
        .map_err(|error| format!("Unable to locate the Downloads folder: {error}"))?;
    Ok(downloads
        .join("Projects Runner Updates")
        .join(format!("v{version}")))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn downloaded_update(state: &UpdateState) -> Result<DownloadedUpdate, String> {
    state
        .downloaded
        .lock()
        .map_err(|_| "Update state is unavailable.".to_string())?
        .clone()
        .ok_or_else(|| "No downloaded update is available.".to_string())
}

#[tauri::command]
pub async fn check_for_update(state: State<'_, UpdateState>) -> Result<UpdateCheckResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Unable to initialize update client: {error}"))?;
    let release = client
        .get(RELEASES_API_URL)
        .header(USER_AGENT, "ProjectsRunnerApp-Updater")
        .header(ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| format!("Unable to contact GitHub: {error}"))?
        .error_for_status()
        .map_err(|error| format!("GitHub did not return a release: {error}"))?
        .json::<GithubRelease>()
        .await
        .map_err(|error| format!("GitHub returned invalid release data: {error}"))?;

    let current = current_version()?;
    let latest = release_version(&release.tag_name)?;
    let mut pending = state
        .pending
        .lock()
        .map_err(|_| "Update state is unavailable.".to_string())?;
    *pending = None;

    if release.draft || release.prerelease || latest <= current {
        return Ok(UpdateCheckResult { update: None });
    }

    let Some((asset, install_action)) = current_platform_asset(&release.assets) else {
        return Ok(UpdateCheckResult { update: None });
    };
    let sha256 = normalize_sha256(asset.digest.as_deref())?;
    let info = UpdateInfo {
        current_version: current.to_string(),
        version: latest.to_string(),
        asset_name: asset.name.clone(),
        asset_size: asset.size,
        install_action: install_action.to_string(),
    };
    // Keep the URL and digest only in native state so the webview cannot select arbitrary executables.
    *pending = Some(PendingUpdate {
        info: info.clone(),
        url: asset.browser_download_url.clone(),
        sha256,
    });
    Ok(UpdateCheckResult { update: Some(info) })
}

#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<String, String> {
    let pending = state
        .pending
        .lock()
        .map_err(|_| "Update state is unavailable.".to_string())?
        .clone()
        .ok_or_else(|| "No update is ready to download.".to_string())?;
    {
        let mut downloading = state
            .downloading
            .lock()
            .map_err(|_| "Update state is unavailable.".to_string())?;
        if *downloading {
            return Err("An update download is already in progress.".to_string());
        }
        *downloading = true;
    }

    let result = async {
        let _ = app.emit(
            DOWNLOAD_EVENT,
            DownloadEvent::Started {
                total_bytes: pending.info.asset_size,
            },
        );
        let directory = update_download_directory(&app, &pending.info.version)?;
        fs::create_dir_all(&directory)
            .map_err(|error| format!("Unable to create update folder: {error}"))?;
        let destination = directory.join(&pending.info.asset_name);
        let temporary = destination.with_extension(format!(
            "{}part",
            destination
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
        ));
        let _ = fs::remove_file(&temporary);

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60 * 30))
            .build()
            .map_err(|error| format!("Unable to initialize download client: {error}"))?;
        let response = client
            .get(&pending.url)
            .header(USER_AGENT, "ProjectsRunnerApp-Updater")
            .send()
            .await
            .map_err(|error| format!("Unable to download update: {error}"))?
            .error_for_status()
            .map_err(|error| format!("Update download failed: {error}"))?;
        let total = response.content_length().unwrap_or(pending.info.asset_size);
        let mut stream = response.bytes_stream();
        let mut file =
            File::create(&temporary).map_err(|error| format!("Unable to save update: {error}"))?;
        let mut hasher = Sha256::new();
        let mut downloaded = 0_u64;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| format!("Update download interrupted: {error}"))?;
            file.write_all(&chunk)
                .map_err(|error| format!("Unable to save update: {error}"))?;
            hasher.update(&chunk);
            downloaded += chunk.len() as u64;
            let _ = app.emit(
                DOWNLOAD_EVENT,
                DownloadEvent::Progress {
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                },
            );
        }
        file.flush()
            .map_err(|error| format!("Unable to finalize update: {error}"))?;
        if downloaded != pending.info.asset_size {
            return Err(
                "Downloaded update size does not match the GitHub release asset.".to_string(),
            );
        }
        let actual = format!("{:x}", hasher.finalize());
        if actual != pending.sha256 {
            return Err("Downloaded update failed its SHA-256 integrity check.".to_string());
        }
        let _ = fs::remove_file(&destination);
        fs::rename(&temporary, &destination)
            .map_err(|error| format!("Unable to finalize update file: {error}"))?;
        *state
            .downloaded
            .lock()
            .map_err(|_| "Update state is unavailable.".to_string())? = Some(DownloadedUpdate {
            path: destination.clone(),
            expected_sha256: pending.sha256.clone(),
            install_action: pending.info.install_action.clone(),
        });
        let path = destination.to_string_lossy().to_string();
        let _ = app.emit(
            DOWNLOAD_EVENT,
            DownloadEvent::Finished { path: path.clone() },
        );
        Ok(path)
    }
    .await;

    if let Err(message) = &result {
        let _ = app.emit(
            DOWNLOAD_EVENT,
            DownloadEvent::Failed {
                message: message.clone(),
            },
        );
    }
    if let Ok(mut downloading) = state.downloading.lock() {
        *downloading = false;
    }
    result
}

#[tauri::command]
pub fn reveal_downloaded_update(state: State<'_, UpdateState>) -> Result<(), String> {
    let update = downloaded_update(&state)?;
    if !update.path.is_file() {
        return Err("The downloaded update file is no longer available.".to_string());
    }
    #[cfg(target_os = "windows")]
    Command::new("explorer.exe")
        .arg("/select,")
        .arg(&update.path)
        .spawn()
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    Command::new("open")
        .arg("-R")
        .arg(&update.path)
        .spawn()
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "linux")]
    Command::new("xdg-open")
        .arg(
            update
                .path
                .parent()
                .ok_or_else(|| "Invalid update path.".to_string())?,
        )
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn install_downloaded_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<(), String> {
    let update = downloaded_update(&state)?;
    if update.install_action != "install" {
        return reveal_downloaded_update(state);
    }
    if !update.path.is_file() || sha256_file(&update.path)? != update.expected_sha256 {
        return Err(
            "The downloaded installer is missing or failed its SHA-256 integrity check."
                .to_string(),
        );
    }
    #[cfg(target_os = "windows")]
    {
        Command::new(&update.path)
            .spawn()
            .map_err(|error| format!("Unable to launch the installer: {error}"))?;
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(500));
            app.exit(0);
        });
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    reveal_downloaded_update(state)
}
