# Releasing Projects Runner

This repository publishes desktop installers directly to GitHub Releases. Releases are public as soon as the workflow succeeds.

## Versioning

Keep the version in these files in sync:

- `package.json`
- `src-tauri/tauri.conf.json`

The workflow enforces this with `npm run release:check`.

## Release workflow

1. Update the version in `package.json` and `src-tauri/tauri.conf.json`.
2. Commit and push the version change to `master`.
3. Create a tag named `app-v<version>` on that release commit.
4. Push the tag to GitHub.
5. The `Publish Release` workflow will start automatically and publish a public release named `Projects Runner v<version>`.

The pushed tag must match the version inside `package.json` and `src-tauri/tauri.conf.json`. For example, version `0.4.6` must be released with tag `app-v0.4.6`.

## Produced artifacts

- Windows: NSIS `.exe`
- Linux: `.AppImage` and `.deb`
- macOS Apple Silicon: `.dmg`

## Supporting workflows

- `Manual CI Build`: optional manual workflow if you want to validate bundles without creating a release.
- `Publish Release`: runs only for `app-v*` tags, builds all supported bundles, and publishes a public GitHub Release.

## Example commands

```bash
git commit -am "Release v0.4.6"
git push origin master
git tag app-v0.4.6
git push origin app-v0.4.6
```

With this setup, pushing to `master` alone does not build artifacts. The release build starts only after the matching `app-v*` tag is pushed.

## One-command helper

You can automate the local release flow with:

```bash
npm run release:publish -- 0.4.7
```

The helper script:

- requires a clean `master` branch
- updates `package.json`, `package-lock.json`, and `src-tauri/tauri.conf.json`
- runs `npm run release:check`
- creates a `Release v0.4.7` commit
- pushes `master`
- creates and pushes the `app-v0.4.7` tag

## Notes

- Windows release builds use the standard WebView2 bootstrapper instead of the local `skip` mode from the legacy PowerShell script.
- macOS release builds use ad-hoc signing (`APPLE_SIGNING_IDENTITY="-"`) for Apple Silicon bundles.
- Linux release builds target `ubuntu-22.04` and package `AppImage` plus `DEB`.
