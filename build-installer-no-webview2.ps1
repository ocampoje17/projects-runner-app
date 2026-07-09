param(
  [switch]$Clean,
  [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$AppRoot = $PSScriptRoot
$TauriDir = Join-Path $AppRoot "src-tauri"
$TempDir = Join-Path $AppRoot ".tauri-build"
$TempConfig = Join-Path $TempDir "tauri.no-webview2.conf.json"
$NsisBundleDir = Join-Path $TauriDir "target\release\bundle\nsis"
$TauriCli = Join-Path $AppRoot "node_modules\.bin\tauri.cmd"

function Assert-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Khong tim thay lenh '$Name'. Hay cai dat '$Name' va thu lai."
  }
}

Push-Location $AppRoot
try {
  if (-not (Test-Path (Join-Path $AppRoot "package.json"))) {
    throw "Khong tim thay package.json trong $AppRoot"
  }

  if (-not (Test-Path (Join-Path $TauriDir "tauri.conf.json"))) {
    throw "Khong tim thay src-tauri\tauri.conf.json"
  }

  Assert-Command "npm"
  Assert-Command "cargo"

  if ($Clean) {
    $DistDir = Join-Path $AppRoot "dist"
    $ReleaseBundleDir = Join-Path $TauriDir "target\release\bundle"

    if (Test-Path $DistDir) {
      Remove-Item -LiteralPath $DistDir -Recurse -Force
    }

    if (Test-Path $ReleaseBundleDir) {
      Remove-Item -LiteralPath $ReleaseBundleDir -Recurse -Force
    }
  }

  if (-not $SkipNpmInstall -and -not (Test-Path (Join-Path $AppRoot "node_modules"))) {
    npm install
  }

  if (-not (Test-Path $TauriCli)) {
    throw "Khong tim thay Tauri CLI tai $TauriCli. Hay chay 'npm install' roi thu lai."
  }

  New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

  $NoWebview2Config = [ordered]@{
    bundle = [ordered]@{
      targets = @("nsis")
      windows = [ordered]@{
        webviewInstallMode = [ordered]@{
          type = "skip"
        }
      }
    }
  }

  $NoWebview2Config |
    ConvertTo-Json -Depth 10 |
    Set-Content -LiteralPath $TempConfig -Encoding UTF8

  & $TauriCli build --bundles nsis --config $TempConfig --ci

  $Installer = Get-ChildItem -LiteralPath $NsisBundleDir -Filter "*setup.exe" -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $Installer) {
    throw "Build xong nhung khong tim thay file setup.exe trong $NsisBundleDir"
  }

  Write-Host ""
  Write-Host "Installer da tao:"
  Write-Host $Installer.FullName
  Write-Host ""
  Write-Host "Luu y: script dat WebView2 install mode = skip, nen installer khong nhung va khong cai WebView2."
}
finally {
  Pop-Location
}
