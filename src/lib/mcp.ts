import { invoke } from "@tauri-apps/api/core";
import type {
  McpStatus,
  McpSettings,
  McpClient,
  McpClientUpdate,
  McpClientToken,
  McpActivityPage,
  McpBridgeInfo,
} from "../types/generated/mcp";
export type * from "../types/generated/mcp";

export function mcpError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error)
    return String(error.message);
  return String(error);
}
export const MCP_PERMISSION_GROUPS = [
  {
    title: "Projects",
    permissions: [
      ["projects.read", "Read"],
      ["projects.create", "Create"],
      ["projects.update", "Edit"],
      ["projects.delete", "Delete"],
    ],
  },
  {
    title: "Commands",
    permissions: [
      ["commands.read", "Read"],
      ["commands.create", "Create"],
      ["commands.update", "Edit"],
      ["commands.delete", "Delete"],
      ["commands.execute", "Run, stop and restart"],
      ["commands.output.read", "Read output"],
    ],
  },
  {
    title: "Notes",
    permissions: [
      ["notes.read", "Read"],
      ["notes.create", "Create"],
      ["notes.update", "Edit"],
      ["notes.delete", "Delete"],
    ],
  },
  {
    title: "2FA",
    permissions: [
      ["twofa.accounts.read", "List accounts"],
      ["twofa.codes.read", "Get OTP"],
    ],
  },
  {
    title: "Data Sync",
    permissions: [
      ["sync.read", "Read status"],
      ["sync.run", "Sync configured data and preferences"],
    ],
  },
] as const;

export function clientPolicy(client: McpClient): McpClientUpdate {
  return {
    name: client.name,
    enabled: client.enabled,
    project_scope: client.project_scope,
    permissions: client.permissions,
    project_ids: client.project_ids,
    account_ids: client.account_ids,
    expected_policy_revision: client.policy_revision,
  };
}
export function connectionConfig(
  mode: "http" | "stdio",
  endpoint: string,
  token: string,
  bridgePath?: string | null,
): string {
  return JSON.stringify(
    {
      mcpServers: {
        "projects-runner":
          mode === "http"
            ? {
                type: "http",
                url: endpoint,
                headers: { Authorization: `Bearer ${token}` },
              }
            : {
                command: bridgePath ?? "projects-runner-mcp",
                args: ["--url", endpoint],
                env: { PROJECTS_RUNNER_MCP_TOKEN: token },
              },
      },
    },
    null,
    2,
  );
}
export const mcpApi = {
  status: () => invoke<McpStatus>("mcp_get_status"),
  settings: (settings: McpSettings) =>
    invoke<McpStatus>("mcp_update_settings", { settings }),
  restart: () => invoke<McpStatus>("mcp_restart_server"),
  test: () => invoke<string>("mcp_test_connection"),
  clients: () => invoke<McpClient[]>("mcp_list_clients"),
  create: (name: string) =>
    invoke<McpClientToken>("mcp_create_client", { name }),
  update: (id: string, update: McpClientUpdate) =>
    invoke<McpClient>("mcp_update_client", { id, update }),
  rotate: (id: string) =>
    invoke<McpClientToken>("mcp_rotate_client_token", { id }),
  remove: (id: string) => invoke<void>("mcp_delete_client", { id }),
  activity: (
    clientId: string | null,
    success: boolean | null,
    offset: number,
  ) =>
    invoke<McpActivityPage>("mcp_list_activity", { clientId, success, offset }),
  bridge: () => invoke<McpBridgeInfo>("mcp_get_bridge_info"),
};
