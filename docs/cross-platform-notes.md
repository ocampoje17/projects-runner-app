# Cross-Platform Notes

Projects Runner now targets Windows, Linux, and macOS builds from GitHub Actions, but command execution remains inherently platform-sensitive.

## Command scripts are OS-specific

Each command currently stores a single `script` payload. That means:

- the app binary can run on multiple operating systems
- an individual saved command may still only work on the operating system it was written for

Examples:

- PowerShell scripts are Windows-specific
- `sh` scripts are typically Linux/macOS-specific
- terminal program names differ across Linux desktop environments

## Runtime hardening goals

The desktop runtime is hardened to reduce cross-platform failures in these areas:

- GUI `PATH` inheritance on macOS and Linux
- external terminal selection on Linux
- non-Windows port and process management fallbacks

## Release expectations

Public releases are published immediately when the release workflow succeeds. There is no draft-release stage in this repository's workflow.

## Current platform targets

- Windows: NSIS installer
- Linux: AppImage and DEB
- macOS: Apple Silicon DMG
