# MCP

Projects Runner exposes a local MCP server while the desktop app is open. It is disabled by default.

## Connect an AI client

1. Open **Settings → MCP** and enable MCP. The default endpoint is `http://127.0.0.1:6811/mcp`.
2. Click **Add client**, enter a name, and copy its token or connection config. The token is shown once.
3. Select the projects and permissions this client can use. New clients start with no permissions and no selected resources.
4. Paste the generated config into your AI client's MCP settings. Restart or refresh the client's tools when changing permissions.

Each client has its own token. **Replace token** immediately invalidates the previous token; update the AI client's configuration afterward. Disabling or deleting a client also immediately removes access.

### HTTP

Use an AI client that supports Streamable HTTP and an Authorization header:

```json
{
  "mcpServers": {
    "projects-runner": {
      "type": "http",
      "url": "http://127.0.0.1:6811/mcp",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}
```

Client-specific configuration formats can differ. Settings provides a copyable template.

### stdio

The installer includes `projects-runner-mcp`. Settings copies it to a stable user-local path and returns that exact path in **Connection config → stdio bridge**. Use the generated path, especially on Linux AppImage, where the mounted application path changes between launches.

```json
{
  "mcpServers": {
    "projects-runner": {
      "command": "ABSOLUTE_PATH_FROM_SETTINGS",
      "args": ["--url", "http://127.0.0.1:6811/mcp"],
      "env": { "PROJECTS_RUNNER_MCP_TOKEN": "YOUR_TOKEN" }
    }
  }
}
```

The bridge connects to the running desktop app. It does not open the app or read its database. Ordinary output goes to stderr; stdout carries MCP messages. Failed operations are not retried automatically. If a connection fails after submitting a mutation, inspect the app before repeating it.

## Permissions

| Section | Controls |
| --- | --- |
| Projects | Read, create, edit, delete; all projects or an explicit selection |
| Commands | Read, create, edit, delete, execute, read output; command groups use the corresponding CRUD permissions |
| Notes | Independent read/create/edit/delete permissions; edits require the version returned by the last read |
| 2FA | Separate account-list and OTP permissions, plus an explicit account allowlist |
| Data Sync | Read status or start the configured sync; starting sync requires All projects |

Selecting All projects includes future projects. With Selected projects, a project created by that client is automatically added to its selection. Selecting projects does not grant access to their 2FA accounts. Deleting a project through MCP preserves the accounts and removes their project links.

Reading projects never returns notes. Executing commands does not grant access to scripts through another tool or to their output. Saved command execution accepts a command ID; create/edit permissions are required to change a script. Deleting running commands or projects is rejected.

`commands_update` returns the full saved command only when the client also has `commands.read`. Otherwise it returns only `{ "command_id": 123, "updated": true }`, including when the request contains only a command ID. Edit permission does not grant read permission. `commands_create` keeps its existing response.

Command start and restart re-check the current client token, execute permission, project selection and MCP enabled state immediately before creating a new run. If access is revoked while restart waits for the previous run to stop, the new run is rejected. Revocation does not stop processes that have already started or undo a stop already requested. The final permission check and process start are serialized with policy changes, token replacement, client deletion and disabling MCP: whichever acquires the command-operation lock first takes effect first.

## OTP

Select the permitted accounts and enable **Get OTP**. Unlock the vault in the desktop app before asking the AI for a code. MCP cannot accept a vault password/PIN or unlock the vault, and requests do not extend the vault's auto-lock timer.

`twofa_get_code` accepts one nonempty account ID and returns the code with its expiration time. The account-list tool returns only issuer/account labels for the selected accounts while the vault is open. Vault secrets, project links and account notes are not returned. Activity records do not contain OTPs.

## Commands and output

All three saved runtime modes are supported. Interactive sessions started by MCP open in the app and remain usable from the terminal UI. External terminal output is unavailable when the app cannot capture it.

Output reads use a cursor and are limited to 64 KiB per call. Buffers retain at most 1 MiB per run, 64 MiB total and 20 finished runs. A stale cursor returns `truncated: true`. Buffers and sync jobs are cleared on app exit. Turning MCP off does not stop commands.

## Data Sync

Configure the sync folder and data groups in **Settings → Data Sync**. MCP uses that configuration and the app's current preferences.

`sync_start` returns a job ID. The app automatically commits a sync with no decisions to make. Project matches and version conflicts open the existing review dialog. Complete or cancel it in the app; the AI can poll `sync_get_job`. Only the client that created the job can read it.

Sync can update every configured data group and app preference, so **Sync configured data and preferences** requires All projects. MCP tokens, clients, activity and settings are never included in the sync snapshot.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Cannot connect | Open the app and check that Settings → MCP shows Running. Use Test connection. |
| Port unavailable | Select another port and update the AI client's endpoint. A failed port change keeps the old listener active. |
| HTTP 401 | Check the token, client enabled state and whether its token was replaced. |
| HTTP 403 | Use the exact `127.0.0.1:PORT` host. Browser Origins must match that local endpoint. |
| Tools missing | Grant the required permissions and refresh the AI client's discovery cache. Direct calls still enforce current permissions. |
| NOT_FOUND | Check project/account selection and resource IDs. Out-of-scope resources intentionally return this error. |
| VAULT_LOCKED | Unlock the vault in the app. |
| CONFLICT | Reload the note or client policy and apply changes to the latest version. |
| APP_NOT_READY | Wait for the desktop UI to finish loading before starting sync. |
| SYNC_BUSY | Finish or cancel the current sync review. |
| Bridge unavailable in a source checkout | Run `cargo build --manifest-path src-tauri/Cargo.toml --bin projects-runner-mcp` before opening MCP settings. |

## Development verification

The command authorization regression suite is `mcp::tests::command_security`. It uses a temporary database, dummy secrets and a fake process launcher. Barriers control revocation before launch and launch before revocation without timing sleeps. Run security checks only in an OS sandbox with external networking disabled, an allowlisted environment and scratch-local home/caches, read-only source/toolchain, scratch-only writes, and CPU, memory, process, file-size, disk and wall-clock limits. With dependencies already available inside that sandbox, run:

```sh
cargo test --offline --locked --manifest-path src-tauri/Cargo.toml --lib mcp::tests::command_security
```

```sh
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
npm run bindings:check
npm run release:check
cargo build --manifest-path src-tauri/Cargo.toml --bin projects-runner-mcp
cargo run --manifest-path src-tauri/Cargo.toml --features mcp-integration --bin mcp-smoke
```

The opt-in integration app uses a temporary database and fake OTP account. It runs saved fixture scripts, including a short external terminal. A desktop environment is required. Production builds exclude this harness. Release builds compile the sidecar for the Tauri target and bundle it using `tauri.release.conf.json` on Windows, Linux and macOS.
