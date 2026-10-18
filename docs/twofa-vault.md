# 2FA Authenticator Vault Specification & Architecture

## 1. Overview & Architecture

Projects Runner includes a built-in Two-Factor Authentication (2FA) TOTP manager integrated into developer workspaces.

### 1.1 Single Shared Vault Model
- **Unified Vault**: All 2FA accounts reside in a single encrypted SQLite database store (`twofa_vault` and `twofa_accounts`).
- **Project Linkage**: An account can be linked to zero (unassigned), one, or multiple projects (`twofa_account_projects`).
- **Scoping**: Accounts can be filtered by Project in the sidebar and overview, while remaining accessible across workspaces without duplication.

### 1.2 Cryptographic Design
- **KDF**: Argon2id with recommended desktop parameters:
  - Memory: 64 MiB (`65536` KiB)
  - Iterations: 3 passes
  - Parallelism: 1 lane
  - Salt: 32 cryptographically secure random bytes
- **Cipher**: XChaCha20Poly1305 authenticated encryption with a 24-byte nonce.
- **Memory Security**: All decryption keys and plaintext secret buffers utilize `Zeroizing` containers in Rust to scrub sensitive material from memory on drop.

---

## 2. Auto-Lock & Session Management

### 2.1 Backend Monotonic Auto-Lock Service
The auto-lock mechanism executes exclusively in the Rust backend throughout the application lifecycle:
- **Tick Interval**: Runs every 1 second using monotonic clocks (`Instant`).
- **Dual Idle Triggers**: Vault locks when either:
  - Operating system user idle time exceeds the configured timeout, **OR**
  - Application focus-loss duration exceeds the configured timeout (window minimization is treated as focus loss).
- **Sleep / Wake Detection**: Detects time jumps (> 2 seconds beyond expected tick cadence) during system sleep/suspend/hibernation and locks the vault before serving subsequent IPC calls.
- **Screen Lock Detection**: Supports platform session lock notifications (Windows Terminal Services, macOS NSWorkspace, Linux logind).

### 2.2 Platform Adapters & Linux Conservative Mode
- **Windows**: `GetLastInputInfo` for user idle; Windows Terminal Services for session lock.
- **macOS**: Native IOKit/CoreGraphics user idle detection; `NSWorkspace` notifications for sleep and screen lock.
- **Linux X11**: XScreenSaver extension query via `user-idle`.
- **Linux Wayland / Fallback**: When desktop idle signals are unavailable, the backend engages **Conservative Mode** (`conservative_mode = true`). In this mode:
  - Vault locks immediately upon loss of window focus.
  - Active in-app interaction timeout applies while focused.
  - UI displays an informational badge regarding Wayland compositor limitations.

### 2.3 Session Isolation, State Transitions & Memory Zeroization
- **Session Identification**: Every unlock generates a cryptographically random `session_id` (UUID v4) and increments the vault `revision` counter.
- **Mandatory Session Verification**: All sensitive IPC operations (`copy_code`, `update_account`, `delete_account`, `import`, `export`, `change_password`, `update_settings`) strictly mandate `expected_session_id`. Any request bearing a mismatched or stale session ID is rejected with an authorization error.
- **Unified Lock Transition**: All lock paths (manual user lock, inactivity timeout, OS lock, sleep/wake jump, focus loss) pass through a centralized state transition (`lock_with_reason`). When locking:
  - Active session ID and operation tokens are revoked immediately.
  - In-memory data keys, master keys, and decrypted plaintext buffers are actively zeroized using `Zeroizing<Vec<u8>>` containers.
  - In-memory import previews and sensitive caches are purged.
  - Active clipboard generation counter is incremented to invalidate any pending copy/clear tasks.
  - A `twofa:vault-state-changed` event is dispatched across all frontend windows.
- **Auto-Lock Bypass When Unlocked**: When `lock_enabled == false`, all auto-lock triggers (inactivity timeout, OS sleep, screen lock, Linux focus loss) are completely bypassed. Manual lock IPC (`twofa_lock_vault`) is cleanly rejected with a validation error instructing the user that the vault is set to non-locking mode.
- **Neutral Storage**: Open `twofa-account` tabs in `localStorage` strictly persist the neutral title `"2FA"` and account UUID. Account and issuer names are only populated in memory while the vault is unlocked.
- **Bounded Frontend Polling**: When errors occur or session expires, frontend polling utilizes bounded retries with exponential backoff and stops after 3 failures until user re-authenticates.

### 2.4 Security Operation Coordinator, 3-Phase Execution & Cancellation Isolation
- **Three-Phase Execution Flow**:
  1. *Prepare*: Input validation and sanity checks; acquires atomic `acquire_security_op()` guard (concurrent attempts immediately return `BUSY`); snapshots current session, revision, generation, and atomic `auth_epoch` under brief vault mutex lock.
  2. *Slow Work*: CPU-bound Argon2id hashing, external OS keyring read/write/delete, and DB operations execute in `spawn_blocking` without holding `twofa_vault.lock()`. Keyring operations are never performed inside a SQLite transaction or while holding the in-memory vault mutex.
  3. *Apply*: Re-acquires inner vault mutex; verifies `current_auth_epoch == start_epoch` and `!is_auth_cancelled(operation_id)`. If valid, commits configuration changes, initializes session data, and emits state change event.
- **Auth Cancellation & Session Isolation**:
  - `twofa_cancel_auth(operation_id)` records the `operation_id` with a 60-second TTL in `cancelled_auth_ops` without advancing the global `auth_epoch`. This guarantees cancellation isolation so canceling one dialog request does not invalidate concurrent operations.
  - When closing or switching methods in an in-flight unlock dialog while pending, the frontend signals cancellation with `operation_id`.
  - If the session currently active matches `state.last_auth_operation_id == Some(operation_id)` and was issued by that request, the session is revoked and the vault locks immediately. If a newer operation already established a fresh session, that newer session remains completely intact and unaffected.
- **Fast Lock Guarantee**: Locking operations (manual user lock, inactivity timeout, screen lock, sleep, Linux focus loss) do not wait for the security operation coordinator; they immediately increment global `auth_epoch` to invalidate all in-flight workers, zeroize memory, revoke tokens, and emit events.

---

## 3. TOTP Validation & Clipboard Management

### 3.1 Strict Canonical Validation
- **Secret Encoding**: Standard Base32 decoded with padding flexibility; verifies validity via RFC 6238 TOTP algorithms.
- **Supported Algorithms**: SHA-1, SHA-256, SHA-512 (HOTP is rejected).
- **Digits**: 6, 7, or 8 digits.
- **Period**: Positive integer in seconds (defaults to 30s when omitted).
- **Identification**: At least one of `issuer` or `account` must be non-empty.

### 3.2 Native Clipboard Copy & Auto-Clear
- **Native Invocation**: TOTP codes are computed and copied directly by the Rust backend (`twofa_copy_code`). Desktop builds do not use browser clipboard APIs as fallback.
- **Generation-Tracked Auto-Clear**: Each copy operation captures the current session ID and clipboard generation. The backend timer clears the system clipboard after the configured interval (10s, 20s, 30s, 1m).
- **Match Verification**: The clipboard is only cleared if:
  1. The vault generation still matches the generation at the time of copy (locking the vault immediately invalidates previous copy generations).
  2. The current clipboard content still matches the exact code copied by Projects Runner, preventing accidental clearing of unrelated user clips.

---

## 4. Backup, Export & Import Pipeline

### 4.1 Encrypted Backup Specification (`.pr2fa` v1)
The backup file uses a structured JSON envelope format:
```json
{
  "magic": "PR2FA",
  "version": 1,
  "kdf": {
    "algorithm": "Argon2id",
    "salt": "<base64-encoded 16-byte salt>",
    "memory_kib": 65536,
    "iterations": 3,
    "parallelism": 1
  },
  "cipher": "XChaCha20-Poly1305",
  "nonce": "<base64-encoded 24-byte nonce>",
  "payload": "<base64-encoded ciphertext>"
}
```

The decrypted `payload` (using AAD `b"pr_twofa_backup_v1"`) contains a UTF-8 JSON object:
```json
{
  "version": 1,
  "exported_at": "2026-10-14T10:00:00Z",
  "accounts": [
    {
      "account": "user@example.com",
      "issuer": "GitHub",
      "secret": "JBSWY3DPEHPK3PXP",
      "algorithm": "SHA1",
      "digits": 6,
      "period": 30,
      "project_names": ["My Project"]
    }
  ]
}
```

### 4.2 Safe Atomic File Operations & Pre-Commit Verification
All file exports (Plaintext JSON, Encrypted `.pr2fa`, PNG QR codes) utilize atomic temporary files (`.tmp_<uuid>`):
1. **Target Selection**: Native OS save dialog obtains target destination.
2. **Data Preparation**: Decryption and serialization occur with zeroized buffers.
3. **Staging**: Data is written and flushed to a temporary sibling file (`.tmp_<uuid>`).
4. **Pre-Commit Verification**: Session ID and operation tokens are re-checked immediately before commit (`save_content_with_token_check`). If the vault locked or the session expired while waiting for user dialog, the temporary file is deleted and the export is aborted.
5. **Atomic Rename**: `fs::rename` atomically replaces the target destination file, eliminating corrupted or partial writes.

### 4.3 Import Pipeline & Duplicate Resolution
- **Preview Staging**: Imports from URIs, QR images, Screen QR, or `.pr2fa` files are staged in an in-memory preview cache with a 10-minute auto-expiry.
- **Per-Row Configuration**: Each staged account can be individually toggled (Import / Skip), edited (issuer, account name), and mapped to projects with smart suggestions based on project names.
- **Duplicate Handling**: Overwrite is disallowed to prevent accidental secret loss. Duplicate accounts offer strictly two choices:
  1. **Bỏ qua (Skip)**: Always skips the account, even if modified.
  2. **Thêm liên kết project (Attach to Project)**: Retains the existing account secret and associates selected projects to its project links, only incrementing linked project count when new associations are added.
- **Atomic Commit & Rollback**: Commits execute in a single SQLite transaction. If any failure occurs during commit, the entire transaction is rolled back and the preview is preserved for user correction.

---

## 5. Lock Modes, PIN & Journaled Security Transitions

### 5.1 Lock Modes & Access Configuration
When setting up a 2FA vault, the user creates an 8+ character master password, which derives the master key-wrapping-key (KWK). The vault supports three operational access modes:
1. **Không khóa (Unlocked by default)**:
   - The symmetric data key is wrapped and deposited into the platform OS keyring (`auto_credential_id`).
   - The application automatically unlocks upon launch without prompting for credentials.
   - All auto-lock timers, focus triggers, and sleep/screen-lock events are bypassed.
2. **Có khóa (Locked without PIN)**:
   - The auto-unlock credential is removed from the OS keyring.
   - The vault remains locked on app startup.
   - Unlocking requires the master password.
   - Auto-lock triggers (inactivity, screen lock, sleep, Linux focus loss) automatically lock the vault.
3. **Có khóa và bật PIN (Locked with 6-digit PIN)**:
   - A 6-digit numeric PIN is configured alongside a random 32-byte device secret held in the OS keyring (`pin_credential_id`).
   - Unlocking accepts the 6-digit PIN or master password as fallback.
   - Auto-lock behavior matches the locked mode.

### 5.2 PIN Protection & Atomic Attempt Accounting
- **6-Digit Constraint**: Strictly enforces exactly 6 ASCII digits (`0-9`), preserving leading zeroes.
- **5-Attempt Threshold**: Vault allows up to 5 consecutive failed PIN attempts. Upon reaching 5 failed attempts, the PIN is permanently blocked (`is_pin_blocked = true`).
- **Atomic Pre-Increment**: Before performing Argon2id derivation or verifying PIN cryptography, the backend atomically increments the attempt counter in SQLite:
  ```sql
  UPDATE twofa_unlock_config
  SET pin_failed_attempts = pin_failed_attempts + 1, updated_at = ?
  WHERE id = 1 AND pin_failed_attempts < 5
  ```
- **Fail-Closed on Storage Error**: If the SQLite write fails (e.g. database disk error or locked file), the operation immediately aborts with `STORAGE_ERROR` without verifying the PIN.
- **Credential Store Isolation**: Errors originating from OS credential store access (e.g., keyring locked or daemon unresponsive) return `CREDENTIAL_STORE_UNAVAILABLE` and do not count toward failed PIN attempts.
- **Counter Reset**: Unlocking successfully with the correct PIN or with the master password resets `pin_failed_attempts` to 0.

### 5.3 Security Transition Journal & Fail-Closed Recovery
All structural security modifications (`setup_vault`, `set_lock_enabled`, `set_pin`, `remove_pin`, `change_vault_password`) follow an atomic transition journal protocol:
1. **Master Password Authentication**: Validates master password and decrypts the current data key.
2. **Pre-Commit Journaling**: Writes a structured `SecurityTransitionJournal` JSON (including format version `1`, `vault_uuid`, operation ID, generation numbers, and credential IDs) into `twofa_unlock_config.pending_journal` inside SQLite before modifying any external OS keyring credentials.
3. **Keyring Operation**: Creates new credentials and deletes obsolete credentials from the OS keyring in background threads (`spawn_blocking`) without holding DB locks.
4. **Atomic SQLite Commit**: Updates metadata and unlock configuration in a single transaction, then clears `pending_journal` and `pending_operation`.
5. **Crash & Interruption Recovery & Emergency Access**:
   - If an unexpected termination occurs mid-transition, the vault flags `recovery_required = true`.
   - Normal PIN unlocking and auto-unlocking are suspended; the vault defaults to locked mode.
   - **Emergency Master Password Access**: The user can always unlock the vault using their master password via `twofa_unlock_vault`. Even if the transition journal is corrupted or unparseable, master password verification against Argon2id KWK succeeds and issues a valid session, allowing the user to view, search, export backups, or inspect accounts without risk of total lockout.
   - The backend validates the journal version, checks `vault_uuid` consistency, safely removes orphaned credentials according to the journal, resets the vault to a secure state, and clears the journal via `twofa_retry_recovery`.
6. **Fail-Closed Guarantee on Corrupted Journal Cleanup**: If `pending_journal` is corrupted or has an unsupported version, journal recovery via `twofa_retry_recovery` safely rejects cleanup and keeps `recovery_required = true` to prevent improper credential purging.
7. **Post-Commit State Semantics**:
   - *Enable lock*: Session is revoked immediately, vault locks via centralized service.
   - *Disable lock*: Session remains active; PIN is cleared.
   - *Change password*: A fresh session is issued; PIN is cleared.
   - *Set / change / remove PIN*: Current session remains active; revision is incremented.

### 5.4 Setup Journal & Interrupted Setup Cleanup
- When initializing a new vault (`twofa_setup_vault`), a temporary `twofa_setup_journal` row is persisted before writing keys to the OS keyring.
- If initial setup is interrupted (e.g. process termination before SQLite commit), the database remains uninitialized (`is_initialized = false`), but `setup_cleanup_required` is marked `true`.
- The user can trigger `twofa_cleanup_setup` from the Settings UI to safely purge orphaned credentials from the OS keyring and clear the setup journal before attempting setup again.

---

## 6. IPC Interface Reference

| Command | Arguments | Returns | Description |
|---|---|---|---|
| `twofa_get_status` | - | `TwofaVaultStatus` | Retrieves current vault status, revision, lock mode, capabilities, and cleanup status. |
| `twofa_try_auto_unlock` | - | `TwofaVaultStatus` | Attempts auto-unlock via OS keyring if `lock_enabled == false` with promise deduplication. |
| `twofa_setup_vault` | `password`, `lock_enabled`, `pin?`, `settings?` | `TwofaVaultStatus` | Initializes new vault with chosen lock mode and setup journal protection. |
| `twofa_cleanup_setup` | - | `TwofaVaultStatus` | Cleans up orphaned OS keyring credentials from interrupted setup. |
| `twofa_unlock_vault` | `password`, `operation_id?` | `TwofaVaultStatus` | Unlocks vault using master password with emergency fallback if journal is interrupted or corrupted. |
| `twofa_unlock_with_pin` | `pin`, `operation_id?` | `TwofaVaultStatus` | Unlocks vault using 6-digit PIN with rate limiting. |
| `twofa_cancel_auth` | `operation_id` | `void` | Cancels in-flight authentication operation for the specified ID without global epoch invalidation; revokes session if matching. |
| `twofa_lock_vault` | - | `TwofaVaultStatus` | Manually locks vault (rejected if `lock_enabled == false`). |
| `twofa_set_lock_enabled` | `lock_enabled`, `master_password`, `expected_session_id`, `expected_revision` | `TwofaVaultStatus` | Toggles lock mode with journal protection. |
| `twofa_set_pin` | `pin`, `master_password`, `expected_session_id`, `expected_revision` | `TwofaVaultStatus` | Sets or updates 6-digit PIN. |
| `twofa_remove_pin` | `master_password`, `expected_session_id`, `expected_revision` | `TwofaVaultStatus` | Removes PIN and falls back to master password unlock. |
| `twofa_change_password` | `old_password`, `new_password`, `expected_session_id`, `expected_revision` | `TwofaVaultStatus` | Re-encrypts data key with new master password. |
| `twofa_update_settings` | `settings`, `expected_session_id`, `expected_revision` | `TwofaVaultStatus` | Persists user preferences; returns updated status and revision. |
| `twofa_retry_recovery` | `master_password`, `expected_session_id`, `expected_revision` | `TwofaVaultStatus` | Retries cleanup of interrupted security transition. |
| `twofa_list_accounts` | `project_id?`, `unassigned_only?`, `search?`, `expected_session_id` | `TwofaAccountSummary[]` | Lists accounts matching query filters. |
| `twofa_get_codes` | `account_ids?`, `expected_session_id` | `TwofaCodeBatch` | Computes active TOTP codes in batch. |
| `twofa_copy_code` | `account_id`, `expected_session_id` | `TwofaCopyResult` | Copies TOTP code to native clipboard with auto-clear timer. |
| `twofa_touch_activity` | `expected_session_id` | `void` | Resets user activity timestamp to prevent auto-lock during active usage. |
