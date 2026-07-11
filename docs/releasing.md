# Releasing Projects Runner

This repository publishes desktop installers directly to GitHub Releases. Releases are public as soon as the workflow succeeds.

## Versioning

Keep the version in these files in sync:

- `package.json`
- `src-tauri/tauri.conf.json`

The workflow enforces this with `npm run release:check`.

## Release workflow

1. Update the version in `package.json` and `src-tauri/tauri.conf.json`.
2. Push the commit to `master`.
3. Run the `Publish Release` workflow from the GitHub Actions UI.
4. The workflow will publish a public release named `Projects Runner v<version>` with tag `app-v<version>`.

If the release tag already exists, the workflow fails instead of overwriting the release.

## Produced artifacts

- Windows: NSIS `.exe`
- Linux: `.AppImage` and `.deb`
- macOS Apple Silicon: `.dmg`

## Supporting workflows

- `CI Build`: builds all supported desktop bundles for `master` pushes and pull requests.
- `Publish Release`: builds all supported bundles and publishes a public GitHub Release.

## Notes

- Windows release builds use the standard WebView2 bootstrapper instead of the local `skip` mode from the legacy PowerShell script.
- macOS release builds use ad-hoc signing (`APPLE_SIGNING_IDENTITY="-"`) for Apple Silicon bundles.
- Linux release builds target `ubuntu-22.04` and package `AppImage` plus `DEB`.
