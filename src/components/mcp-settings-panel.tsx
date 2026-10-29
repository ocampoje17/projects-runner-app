import { useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Network,
  Plus,
  Copy,
  RefreshCw,
  KeyRound,
  Trash2,
  UsersRound,
  FolderKanban,
  Terminal,
  NotebookPen,
  ShieldCheck,
  History,
  type LucideIcon,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isDesktopRuntime } from "../lib/api";
import {
  mcpApi,
  mcpError,
  clientPolicy,
  connectionConfig,
  MCP_PERMISSION_GROUPS,
  type McpClient,
  type McpClientUpdate,
  type McpClientToken,
} from "../lib/mcp";
import { useTwofa } from "./twofa/TwofaProvider";
import {
  TwofaLockDialog,
  type TwofaLockDialogMode,
} from "./twofa/twofa-lock-dialog";
import { syncApi, SYNC_GROUPS } from "../lib/data-sync";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { formatDateTime } from "../lib/date-time";

const PERMISSION_SECTION_ICONS = {
  Projects: FolderKanban,
  Commands: Terminal,
  Notes: NotebookPen,
  "2FA": ShieldCheck,
  "Data Sync": RefreshCw,
} satisfies Record<(typeof MCP_PERMISSION_GROUPS)[number]["title"], LucideIcon>;

function Section({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-[var(--vscode-border)] pb-5 last:border-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon
            size={16}
            aria-hidden="true"
            className="shrink-0 text-primary"
          />
          <h3 className="text-[14px] font-semibold tracking-[-0.02em] text-foreground">
            {title}
          </h3>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Row({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 border-b border-[var(--vscode-border)] py-3 text-[12.5px] last:border-0">
      <div className="min-w-0">{title}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
export function McpSettingsPanel() {
  const queryClient = useQueryClient();
  const desktop = isDesktopRuntime();
  const status = useQuery({
    queryKey: ["mcp-status"],
    queryFn: mcpApi.status,
    enabled: desktop,
  });
  const clients = useQuery({
    queryKey: ["mcp-clients"],
    queryFn: mcpApi.clients,
    enabled: desktop,
  });
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
    enabled: desktop,
  });
  const bridge = useQuery({
    queryKey: ["mcp-bridge"],
    queryFn: mcpApi.bridge,
    enabled: desktop,
  });
  const { accounts, isUnlocked, status: vaultStatus } = useTwofa();
  const [vaultDialog, setVaultDialog] = useState<TwofaLockDialogMode | null>(
    null,
  );
  const sync = useQuery({
    queryKey: ["mcp-sync-status"],
    queryFn: syncApi.status,
    enabled: desktop,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    clients.data?.find((c) => c.id === selectedId) ?? clients.data?.[0];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<string | null>(null);
  const [port, setPort] = useState("6811");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [token, setToken] = useState<McpClientToken | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [mode, setMode] = useState<"http" | "stdio">("http");
  const [confirm, setConfirm] = useState<"rotate" | "delete" | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [activityClient, setActivityClient] = useState("all");
  const [activityResult, setActivityResult] = useState("all");
  const [offset, setOffset] = useState(0);
  const activity = useQuery({
    queryKey: ["mcp-activity", activityClient, activityResult, offset],
    queryFn: () =>
      mcpApi.activity(
        activityClient === "all" ? null : activityClient,
        activityResult === "all" ? null : activityResult === "success",
        offset,
      ),
    enabled: desktop,
    refetchInterval: 10000,
  });
  useEffect(() => {
    if (status.data) setPort(String(status.data.settings.port));
  }, [status.data?.settings.port]);
  useEffect(() => {
    if (!desktop) return;
    const pending = listen("mcp://status", () => {
      void queryClient.invalidateQueries({ queryKey: ["mcp-status"] });
    });
    return () => {
      void pending.then((fn) => fn());
    };
  }, [desktop, queryClient]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(mcpError(e));
    } finally {
      setBusy(false);
    }
  }
  async function refreshClients() {
    await queryClient.invalidateQueries({ queryKey: ["mcp-clients"] });
  }
  async function update(patch: Partial<McpClientUpdate>) {
    if (!selected) return;
    await run(async () => {
      try {
        const next = await mcpApi.update(selected.id, {
          ...clientPolicy(selected),
          ...patch,
        });
        queryClient.setQueryData<McpClient[]>(["mcp-clients"], (old) =>
          old?.map((c) => (c.id === next.id ? next : c)),
        );
      } catch (e) {
        await refreshClients();
        throw e;
      }
    });
  }
  function togglePermission(key: string, checked: boolean) {
    if (selected)
      void update({
        permissions: checked
          ? [...selected.permissions, key]
          : selected.permissions.filter((p) => p !== key),
      });
  }
  async function copy(value: string) {
    await run(async () => {
      await navigator.clipboard.writeText(value);
    });
  }
  if (!desktop)
    return (
      <div className="py-8 text-[13px] text-muted-foreground">
        MCP is available in the desktop app.
      </div>
    );
  if (status.isLoading || clients.isLoading)
    return (
      <div role="status" className="py-8 text-[13px]">
        Loading MCP…
      </div>
    );
  const loadError = status.error ?? clients.error;
  const endpoint = status.data?.endpoint ?? "http://127.0.0.1:6811/mcp";
  return (
    <div className="flex flex-col gap-5">
      <Section icon={Network} title="Connection">
        <Row title={<label htmlFor="mcp-enabled">Enable MCP</label>}>
          <Switch
            id="mcp-enabled"
            checked={status.data?.settings.enabled ?? false}
            disabled={busy || !status.data}
            onCheckedChange={(enabled) =>
              void run(async () => {
                const next = await mcpApi.settings({
                  enabled,
                  port: status.data!.settings.port,
                });
                queryClient.setQueryData(["mcp-status"], next);
              })
            }
          />
        </Row>
        <Row title="Status">
          <Badge variant="muted">{status.data?.state ?? "Unavailable"}</Badge>
        </Row>
        <Row title={<label htmlFor="mcp-port">Port</label>}>
          <div className="flex gap-2">
            <Input
              id="mcp-port"
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="w-24"
              disabled={busy}
            />
            <Button
              size="md"
              variant="primary"
              disabled={
                busy ||
                !status.data ||
                !Number.isInteger(Number(port)) ||
                Number(port) < 1 ||
                Number(port) > 65535 ||
                Number(port) === status.data?.settings.port
              }
              onClick={() =>
                void run(async () => {
                  const next = await mcpApi.settings({
                    enabled: status.data!.settings.enabled,
                    port: Number(port),
                  });
                  queryClient.setQueryData(["mcp-status"], next);
                  setPort(String(next.settings.port));
                })
              }
            >
              Apply
            </Button>
          </div>
        </Row>
        <Row
          title={<code className="break-all text-[11.5px]">{endpoint}</code>}
        >
          <Button
            variant="outline"
            size="md"
            className="w-8 px-0"
            aria-label="Copy MCP endpoint"
            onClick={() => void copy(endpoint)}
          >
            <Copy size={14} />
          </Button>
        </Row>
        <div className="mt-3 flex items-center gap-2">
          <Button
            size="md"
            variant="outline"
            disabled={busy || status.data?.state !== "running"}
            onClick={() => void run(async () => setTested(await mcpApi.test()))}
          >
            Test connection
          </Button>
          <Button
            size="md"
            variant="outline"
            disabled={busy || !status.data?.settings.enabled}
            onClick={() =>
              void run(async () => {
                queryClient.setQueryData(
                  ["mcp-status"],
                  await mcpApi.restart(),
                );
              })
            }
          >
            <RefreshCw size={13} />
            Restart
          </Button>
          {tested && (
            <span role="status" className="text-[11px] text-muted-foreground">
              Connected · {formatDateTime(tested)}
            </span>
          )}
        </div>
        {status.data?.error && (
          <p role="alert" className="mt-3 text-[12px] text-destructive">
            {status.data.error}
          </p>
        )}
      </Section>
      {(error || loadError) && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded border border-destructive/30 p-3 text-[12px] text-destructive"
        >
          {error ?? mcpError(loadError)}
          <Button
            variant="outline"
            size="md"
            onClick={() => {
              setError(null);
              void status.refetch();
              void clients.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      )}
      <Section
        icon={UsersRound}
        title="Clients"
        action={
          <Button
            size="md"
            variant="primary"
            disabled={busy}
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={13} />
            Add client
          </Button>
        }
      >
        {!selected ? (
          <div className="py-4 text-[12px] text-muted-foreground">
            No clients
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 py-2">
              <Select
                value={selected.id}
                onValueChange={setSelectedId}
                disabled={busy}
              >
                <SelectTrigger className="w-[240px]" aria-label="MCP client">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {clients.data?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.enabled ? "" : " · Disabled"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="md"
                onClick={() => setConfigOpen(true)}
              >
                Connection config
              </Button>
              <Button
                aria-label="Rotate client token"
                variant="outline"
                size="md"
                className="w-8 px-0"
                disabled={busy}
                onClick={() => setConfirm("rotate")}
              >
                <KeyRound size={14} />
              </Button>
              <Button
                aria-label="Delete MCP client"
                variant="outline"
                size="md"
                className="w-8 px-0"
                disabled={busy}
                onClick={() => setConfirm("delete")}
              >
                <Trash2 size={14} />
              </Button>
            </div>
            <Row title={<label htmlFor="mcp-client-name">Name</label>}>
              <Input
                key={`${selected.id}:${selected.name}`}
                id="mcp-client-name"
                defaultValue={selected.name}
                disabled={busy}
                maxLength={100}
                className="w-[240px]"
                onBlur={(e) => {
                  if (e.target.value.trim() !== selected.name)
                    void update({ name: e.target.value });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </Row>
            <Row
              title={<label htmlFor="mcp-client-enabled">Client access</label>}
            >
              <Switch
                id="mcp-client-enabled"
                checked={selected.enabled}
                disabled={busy}
                onCheckedChange={(enabled) => void update({ enabled })}
              />
            </Row>
            <Row title="Last used">
              <span className="text-muted-foreground">
                {selected.last_used_at
                  ? formatDateTime(selected.last_used_at)
                  : "Never"}
              </span>
            </Row>
          </>
        )}
      </Section>
      {selected &&
        MCP_PERMISSION_GROUPS.map((group) => (
          <Section
            key={group.title}
            icon={PERMISSION_SECTION_ICONS[group.title]}
            title={group.title}
          >
            {group.title === "Projects" && (
              <>
                <Row title="Project access">
                  <Select
                    value={selected.project_scope}
                    disabled={busy}
                    onValueChange={(project_scope) =>
                      void update({ project_scope })
                    }
                  >
                    <SelectTrigger
                      className="w-[200px]"
                      aria-label="Project access"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="selected">
                        Selected projects
                      </SelectItem>
                      <SelectItem value="all">
                        All projects, including new
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Row>
                {selected.project_scope === "selected" && (
                  <div className="border-b border-[var(--vscode-border)] py-3">
                    <Input
                      aria-label="Search projects"
                      placeholder="Search projects"
                      value={projectSearch}
                      onChange={(e) => setProjectSearch(e.target.value)}
                    />
                    <div className="mt-2 max-h-48 overflow-y-auto">
                      {projects.data
                        ?.filter((p) =>
                          p.name
                            .toLowerCase()
                            .includes(projectSearch.toLowerCase()),
                        )
                        .map((p) => (
                          <div key={p.id} className="py-1.5">
                            <Checkbox
                              label={p.name}
                              checked={selected.project_ids.includes(p.id)}
                              disabled={busy}
                              onCheckedChange={(checked) =>
                                void update({
                                  project_ids: checked
                                    ? [...selected.project_ids, p.id]
                                    : selected.project_ids.filter(
                                        (id) => id !== p.id,
                                      ),
                                })
                              }
                            />
                          </div>
                        ))}
                    </div>
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      {selected.project_ids.length} selected
                    </div>
                  </div>
                )}
              </>
            )}
            {group.permissions.map(([key, label]) => (
              <Row
                key={key}
                title={<label htmlFor={`mcp-${key}`}>{label}</label>}
              >
                <Switch
                  id={`mcp-${key}`}
                  checked={selected.permissions.includes(key)}
                  disabled={
                    busy ||
                    (key === "sync.run" && selected.project_scope !== "all")
                  }
                  onCheckedChange={(checked) => togglePermission(key, checked)}
                />
              </Row>
            ))}
            {group.title === "2FA" && (
              <div className="pt-3">
                {!isUnlocked ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[12px] text-muted-foreground">
                      Vault locked · {selected.account_ids.length} selected
                    </span>
                    <Button
                      variant="outline"
                      size="md"
                      onClick={() =>
                        setVaultDialog(
                          vaultStatus?.recovery_required
                            ? "retry-recovery"
                            : vaultStatus?.has_vault
                              ? "unlock"
                              : "setup",
                        )
                      }
                    >
                      {vaultStatus?.has_vault ? "Unlock vault" : "Set up vault"}
                    </Button>
                  </div>
                ) : (
                  <>
                    <Input
                      aria-label="Search 2FA accounts"
                      placeholder="Search accounts"
                      value={accountSearch}
                      onChange={(e) => setAccountSearch(e.target.value)}
                    />
                    <div className="mt-2 max-h-48 overflow-y-auto">
                      {accounts
                        .filter((a) =>
                          `${a.issuer} ${a.account}`
                            .toLowerCase()
                            .includes(accountSearch.toLowerCase()),
                        )
                        .map((a) => (
                          <div key={a.id} className="py-1.5">
                            <Checkbox
                              label={`${a.issuer} · ${a.account}`}
                              checked={selected.account_ids.includes(a.id)}
                              disabled={busy}
                              onCheckedChange={(checked) =>
                                void update({
                                  account_ids: checked
                                    ? [...selected.account_ids, a.id]
                                    : selected.account_ids.filter(
                                        (id) => id !== a.id,
                                      ),
                                })
                              }
                            />
                          </div>
                        ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {group.title === "Data Sync" && (
              <div className="pt-3 text-[11.5px] text-muted-foreground">
                {SYNC_GROUPS.filter(([key]) => sync.data?.scopes[key])
                  .map(([, label]) => label)
                  .join(" · ") || "No sync folder configured"}
                . Running sync requires All projects.
              </div>
            )}
          </Section>
        ))}
      <Section
        icon={History}
        title="Activity"
        action={
          <Button
            variant="outline"
            size="md"
            className="w-8 px-0"
            aria-label="Refresh MCP activity"
            onClick={() => void activity.refetch()}
          >
            <RefreshCw size={13} />
          </Button>
        }
      >
        <div className="flex gap-2 py-2">
          <Select
            value={activityClient}
            onValueChange={(v) => {
              setActivityClient(v);
              setOffset(0);
            }}
          >
            <SelectTrigger className="w-48" aria-label="Activity client">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.data?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={activityResult}
            onValueChange={(v) => {
              setActivityResult(v);
              setOffset(0);
            }}
          >
            <SelectTrigger className="w-36" aria-label="Activity result">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All results</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failure">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11.5px]">
            <thead>
              <tr className="border-b border-[var(--vscode-border)]">
                <th className="py-2 font-medium">Time</th>
                <th>Client</th>
                <th>Tool</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {activity.data?.items.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-[var(--vscode-border)]"
                >
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {formatDateTime(a.created_at)}
                  </td>
                  <td className="pr-3">{a.client_name}</td>
                  <td className="pr-3 font-mono">
                    {a.tool}
                    {a.target_id ? ` · ${a.target_id}` : ""}
                  </td>
                  <td
                    className={
                      a.success ? "text-muted-foreground" : "text-destructive"
                    }
                  >
                    {a.error_code ?? "Success"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!activity.data?.items.length && (
          <div className="py-4 text-[12px] text-muted-foreground">
            No activity
          </div>
        )}
        {activity.error && (
          <p role="alert" className="py-2 text-[12px] text-destructive">
            {mcpError(activity.error)}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button
            size="md"
            variant="outline"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - 50))}
          >
            Previous
          </Button>
          <Button
            size="md"
            variant="outline"
            disabled={!activity.data?.has_more}
            onClick={() => setOffset((o) => o + 50)}
          >
            Next
          </Button>
        </div>
      </Section>
      {vaultDialog && (
        <TwofaLockDialog
          open
          mode={vaultDialog}
          onOpenChange={(open) => {
            if (!open) setVaultDialog(null);
          }}
        />
      )}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add MCP client</DialogTitle>
            <DialogDescription>
              Choose a name for this connection.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const result = await mcpApi.create(newName);
                setToken(result);
                setSelectedId(result.client.id);
                setCreateOpen(false);
                setNewName("");
                await refreshClients();
              });
            }}
          >
            <Input
              aria-label="New client name"
              autoFocus
              maxLength={100}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className="mt-4 flex justify-end">
              <Button
                size="md"
                variant="primary"
                disabled={busy || !newName.trim()}
                type="submit"
              >
                Create client
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!token || configOpen}
        onOpenChange={(open) => {
          if (!open) {
            setToken(null);
            setConfigOpen(false);
          }
        }}
      >
        <DialogContent className="w-[min(680px,calc(100vw-24px))]">
          <DialogHeader>
            <DialogTitle>
              {token ? "Client token" : "Connection config"}
            </DialogTitle>
            <DialogDescription>
              {token
                ? "Copy this token now. It is shown once."
                : "Replace YOUR_TOKEN with the client token."}
            </DialogDescription>
          </DialogHeader>
          {token && (
            <div className="flex items-center gap-2">
              <Input
                aria-label="Client token"
                type="password"
                readOnly
                value={token.token}
              />
              <Button
                size="md"
                variant="outline"
                onClick={() => void copy(token.token)}
              >
                Copy token
              </Button>
            </div>
          )}
          <Select
            value={mode}
            onValueChange={(v) => setMode(v as "http" | "stdio")}
          >
            <SelectTrigger aria-label="Connection transport">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="http">HTTP</SelectItem>
              <SelectItem value="stdio">stdio bridge</SelectItem>
            </SelectContent>
          </Select>
          {mode === "stdio" && bridge.data?.error && (
            <p role="alert" className="text-[12px] text-destructive">
              {bridge.data.error}
            </p>
          )}
          <pre className="max-h-72 overflow-auto rounded border border-[var(--vscode-border)] bg-[var(--vscode-editor)] p-3 text-[11.5px]">
            {connectionConfig(
              mode,
              endpoint,
              token?.token ?? "YOUR_TOKEN",
              bridge.data?.path,
            )}
          </pre>
          <div className="flex justify-end">
            <Button
              size="md"
              variant="primary"
              disabled={mode === "stdio" && !bridge.data?.path}
              onClick={() =>
                void copy(
                  connectionConfig(
                    mode,
                    endpoint,
                    token?.token ?? "YOUR_TOKEN",
                    bridge.data?.path,
                  ),
                )
              }
            >
              <Copy size={13} />
              Copy config
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === "rotate"
                ? "Replace client token?"
                : "Delete client?"}
            </DialogTitle>
            <DialogDescription>
              {confirm === "rotate"
                ? "Existing connections will need the new token."
                : "This client will immediately lose access."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              size="md"
              variant="outline"
              onClick={() => setConfirm(null)}
            >
              Cancel
            </Button>
            <Button
              size="md"
              variant={confirm === "delete" ? "danger" : "primary"}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!selected) return;
                  if (confirm === "rotate")
                    setToken(await mcpApi.rotate(selected.id));
                  else {
                    await mcpApi.remove(selected.id);
                    setSelectedId(null);
                  }
                  setConfirm(null);
                  await refreshClients();
                })
              }
            >
              {confirm === "rotate" ? "Replace token" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
