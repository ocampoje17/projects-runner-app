import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Download,
  Filter,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Unlock,
  Upload,
} from "lucide-react";
import {
  api,
  type Project,
  type SortOrderSetting,
  type TwofaAccountSummary,
} from "@/lib/api";
import { TwofaTokenCard } from "./twofa-token-card";
import { TwofaAccountDialog } from "./twofa-account-dialog";
import { TwofaLockDialog, type TwofaLockDialogMode } from "./twofa-lock-dialog";
import { TwofaExportDialog, type TwofaExportMode } from "./twofa-export-dialog";
import { TwofaImportDialog } from "./twofa-import-dialog";
import { ConfirmDialog } from "@/components/process-dialogs";
import { useTwofa } from "./TwofaProvider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type TwofaOverviewProps = {
  projects: Project[];
  filterProjectId?: number;
  selectedAccountId?: string;
  onSelectProject?: (projectId: number) => void;
};

export function TwofaOverview({
  projects,
  filterProjectId,
  selectedAccountId,
  onSelectProject,
}: TwofaOverviewProps) {
  // Vault state from centralized TwofaProvider
  const {
    status,
    sessionId,
    accounts,
    codesBatch,
    isLoading,
    refreshStatus,
    refreshAccounts,
    lockVault,
    updateSettings,
    isSavingSettings,
    lockEnabled,
  } = useTwofa();

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  // "all" | "unassigned" | projectId number as string
  const [projectFilter, setProjectFilter] = useState<string>(
    filterProjectId !== undefined ? String(filterProjectId) : "all",
  );
  const sortBy = status?.sort_order_setting ?? "ISSUER_ASC";

  useEffect(() => {
    localStorage.removeItem("twofa_overview_sort_by");
  }, []);

  const handleSortChange = async (newSort: SortOrderSetting) => {
    if (!status || !sessionId) return;
    try {
      await updateSettings({
        lock_time_setting: status.lock_time_setting,
        lock_on_screen_lock: status.lock_on_screen_lock,
        hide_token_setting: status.hide_token_setting,
        clear_clipboard_setting: status.clear_clipboard_setting,
        sort_order_setting: newSort,
      });
    } catch (err) {
      console.error("Failed to update sort order setting:", err);
    }
  };

  // Scroll to selected account when opened via Explorer without clobbering search
  useEffect(() => {
    if (selectedAccountId && accounts.length > 0) {
      const match = accounts.find((a) => a.id === selectedAccountId);
      if (match) {
        if (projectFilter !== "all" && projectFilter !== "unassigned") {
          const currentPId = Number.parseInt(projectFilter, 10);
          if (!match.project_ids.includes(currentPId)) {
            setProjectFilter("all");
          }
        }
        setTimeout(() => {
          const element = document.getElementById(`twofa-token-${selectedAccountId}`);
          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
            element.classList.add("ring-2", "ring-[var(--primary-color,#007acc)]");
            setTimeout(() => {
              element.classList.remove("ring-2", "ring-[var(--primary-color,#007acc)]");
            }, 2500);
          }
        }, 100);
      }
    }
  }, [selectedAccountId, accounts, projectFilter]);

  // Dialogs
  const [lockDialogState, setLockDialogState] = useState<{
    open: boolean;
    mode: TwofaLockDialogMode;
  }>({ open: false, mode: "unlock" });

  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [accountToEdit, setAccountToEdit] = useState<TwofaAccountSummary | null>(null);

  const [exportDialogState, setExportDialogState] = useState<{
    open: boolean;
    mode: TwofaExportMode;
    account?: TwofaAccountSummary | null;
  }>({ open: false, mode: "plaintext" });

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState<TwofaAccountSummary | null>(null);

  // Update projectFilter if filterProjectId prop changes
  useEffect(() => {
    if (filterProjectId !== undefined) {
      setProjectFilter(String(filterProjectId));
    }
  }, [filterProjectId]);

  const refreshVaultData = useCallback(async () => {
    await Promise.all([refreshStatus(), refreshAccounts()]);
  }, [refreshStatus, refreshAccounts]);

  // Automatically close sensitive dialogs when vault locks
  useEffect(() => {
    if (!status?.is_unlocked) {
      setAccountDialogOpen(false);
      setExportDialogState({ open: false, mode: "plaintext" });
      setImportDialogOpen(false);
      setAccountToDelete(null);
    }
  }, [status?.is_unlocked]);


  async function handleLockVault() {
    try {
      await lockVault();
    } catch {
      // Ignore
    }
  }

  async function handleConfirmDelete() {
    if (!accountToDelete || !sessionId) return;
    try {
      await api.twofaDeleteAccount(accountToDelete.id, sessionId);
      setAccountToDelete(null);
      void refreshVaultData();
    } catch {
      // Ignore
    }
  }

  // Filter and sort accounts
  const filteredAccounts = useMemo(() => {
    let result = [...accounts];

    // Project filter
    if (projectFilter === "unassigned") {
      result = result.filter((a) => a.project_ids.length === 0);
    } else if (projectFilter !== "all") {
      const pId = Number.parseInt(projectFilter, 10);
      result = result.filter((a) => a.project_ids.includes(pId));
    }

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (a) =>
          a.issuer.toLowerCase().includes(q) ||
          (a.account || "").toLowerCase().includes(q) ||
          (a.notes && a.notes.toLowerCase().includes(q)),
      );
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case "ISSUER_DESC":
          return (b.issuer || b.account || "").localeCompare(a.issuer || a.account || "");
        case "CREATED_DESC":
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case "CREATED_ASC":
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case "ISSUER_ASC":
        default:
          return (a.issuer || a.account || "").localeCompare(b.issuer || b.account || "");
      }
    });

    return result;
  }, [accounts, projectFilter, searchQuery, sortBy]);

  const activeProject =
    projectFilter !== "all" && projectFilter !== "unassigned"
      ? projects.find((p) => p.id === Number.parseInt(projectFilter, 10))
      : null;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--background,#1e1e1e)] text-[var(--foreground)]">
      {/* Top Header / Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[var(--border)] bg-[var(--card,#252526)] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Project filter dropdown */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Filter className="h-3.5 w-3.5 shrink-0" />
            <Select value={projectFilter} onValueChange={(val) => setProjectFilter(val)}>
              <SelectTrigger className="h-7 min-w-[150px] text-xs font-medium">
                <SelectValue placeholder="All Accounts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Accounts ({accounts.length})</SelectItem>
                <SelectItem value="unassigned">
                  Unassigned ({accounts.filter((a) => a.project_ids.length === 0).length})
                </SelectItem>
                {projects.map((p) => {
                  const count = accounts.filter((a) => a.project_ids.includes(p.id)).length;
                  return (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name} ({count})
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Search box */}
          {status?.is_unlocked ? (
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search 2FA accounts..."
                className="h-7 w-40 sm:w-56 rounded-[4px] border border-[var(--input-border)] bg-[var(--bg-input,#1f1f1f)] pl-8 pr-2 text-xs text-[var(--foreground)] focus:border-[var(--primary-color,#007acc)] focus:outline-none"
              />
            </div>
          ) : null}

          {/* Sort dropdown */}
          {status?.is_unlocked && accounts.length > 0 ? (
            <Select
              value={sortBy}
              onValueChange={(val) => handleSortChange(val as SortOrderSetting)}
              disabled={isSavingSettings}
            >
              <SelectTrigger className="h-7 min-w-[140px] text-xs font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ISSUER_ASC">Sort: Issuer (A-Z)</SelectItem>
                <SelectItem value="ISSUER_DESC">Sort: Issuer (Z-A)</SelectItem>
                <SelectItem value="CREATED_DESC">Sort: Newest First</SelectItem>
                <SelectItem value="CREATED_ASC">Sort: Oldest First</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5">
          {status?.is_unlocked ? (
            <>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setAccountToEdit(null);
                  setAccountDialogOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" /> Add Account
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportDialogOpen(true)}
                title="Import Accounts"
              >
                <Upload className="h-3.5 w-3.5" /> Import
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setExportDialogState({ open: true, mode: "encrypted" })}
                title="Export Vault Backup"
              >
                <Download className="h-3.5 w-3.5" /> Export
              </Button>

              {lockEnabled && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleLockVault()}
                  title="Lock 2FA Vault"
                >
                  <Lock className="h-3.5 w-3.5" /> Lock
                </Button>
              )}
            </>
          ) : status?.has_vault ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setLockDialogState({ open: true, mode: "unlock" })}
            >
              <Unlock className="h-3.5 w-3.5" /> Unlock Vault
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setLockDialogState({ open: true, mode: "setup" })}
            >
              <ShieldCheck className="h-3.5 w-3.5" /> Set Up Vault
            </Button>
          )}
        </div>
      </div>

      {/* Main Body */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading vault...
          </div>
        ) : !status?.has_vault ? (
          /* Vault Not Initialized Banner */
          <div className="mx-auto my-8 max-w-md flex flex-col items-center justify-center gap-3.5 rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] p-8 text-center shadow-sm">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--primary-color)]/10 text-[var(--primary-color)]">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-base font-semibold">2FA Vault Not Initialized</h3>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                Projects Runner provides a secure, encrypted TOTP two-factor authentication vault. Set a master password to get started.
              </p>
            </div>
            <Button
              variant="primary"
              size="md"
              onClick={() => setLockDialogState({ open: true, mode: "setup" })}
              className="mt-2"
            >
              <ShieldCheck className="h-4 w-4" /> Create Vault Password
            </Button>
          </div>
        ) : !status.is_unlocked ? (
          /* Vault Locked Banner */
          <div className="mx-auto my-8 max-w-md flex flex-col items-center justify-center gap-3.5 rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] p-8 text-center shadow-sm">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
              <Lock className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-base font-semibold">2FA Vault is Locked</h3>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                Your vault is locked to protect your 2FA accounts. Enter your master password to decrypt accounts and generate live TOTP codes.
              </p>
            </div>
            <Button
              variant="primary"
              size="md"
              onClick={() => setLockDialogState({ open: true, mode: "unlock" })}
              className="mt-2"
            >
              <Unlock className="h-4 w-4" /> Unlock Vault
            </Button>
          </div>
        ) : filteredAccounts.length === 0 ? (
          /* Empty state */
          <div className="mx-auto my-12 max-w-sm flex flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--vscode-panel)] text-muted-foreground">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold">No 2FA Accounts Found</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                {searchQuery
                  ? "No accounts match your search filter."
                  : activeProject
                    ? `No 2FA accounts are currently linked to "${activeProject.name}".`
                    : "Your 2FA vault is empty. Add your first account or import from 2FAGuard."}
              </p>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setAccountToEdit(null);
                  setAccountDialogOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" /> Add Account
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportDialogOpen(true)}
              >
                Import Accounts
              </Button>
            </div>
          </div>
        ) : (
          /* Cards Grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
            {filteredAccounts.map((account) => {
              const codeItem = codesBatch?.codes.find((c) => c.account_id === account.id);
              return (
                <div key={account.id} id={`twofa-token-${account.id}`} className="rounded-[8px] transition-all">
                  <TwofaTokenCard
                    account={account}
                    codeItem={codeItem}
                    projects={projects}
                    sessionId={status?.session_id}
                    hideTokenSetting={status?.hide_token_setting}
                    onEdit={(acc) => {
                      setAccountToEdit(acc);
                      setAccountDialogOpen(true);
                    }}
                    onDelete={(acc) => setAccountToDelete(acc)}
                    onViewQr={(acc) =>
                      setExportDialogState({ open: true, mode: "qr", account: acc })
                    }
                    onFilterProject={(pId) => {
                      setProjectFilter(String(pId));
                      onSelectProject?.(pId);
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Account Dialog (Add / Edit) */}
      <TwofaAccountDialog
        open={accountDialogOpen}
        onOpenChange={setAccountDialogOpen}
        initialAccount={accountToEdit}
        defaultProjectId={
          projectFilter !== "all" && projectFilter !== "unassigned"
            ? Number.parseInt(projectFilter, 10)
            : undefined
        }
        projects={projects}
        onSaved={() => void refreshVaultData()}
      />

      {/* Lock / Unlock / Change Password Dialog */}
      <TwofaLockDialog
        open={lockDialogState.open}
        onOpenChange={(open) => setLockDialogState((prev) => ({ ...prev, open }))}
        mode={lockDialogState.mode}
        onSuccess={() => void refreshVaultData()}
      />

      {/* Export Dialog */}
      <TwofaExportDialog
        open={exportDialogState.open}
        onOpenChange={(open) => setExportDialogState((prev) => ({ ...prev, open }))}
        mode={exportDialogState.mode}
        account={exportDialogState.account}
        accounts={accounts}
      />

      {/* Import Dialog */}
      <TwofaImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        defaultProjectId={
          projectFilter !== "all" && projectFilter !== "unassigned"
            ? Number.parseInt(projectFilter, 10)
            : undefined
        }
        projects={projects}
        onImported={() => void refreshVaultData()}
      />

      {/* Delete Account Confirmation Dialog */}
      <ConfirmDialog
        open={accountToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setAccountToDelete(null);
        }}
        title="Delete 2FA Account"
        description={`Are you sure you want to delete "${accountToDelete?.issuer || "2FA Account"}" (${accountToDelete?.account || ""})? This will permanently remove its secret key from your vault.`}
        confirmLabel="Delete Account"
        isDestructive={true}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  );
}
