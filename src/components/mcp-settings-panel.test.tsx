// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { McpSettingsPanel } from "./mcp-settings-panel";
import { mcpApi, type McpClient } from "../lib/mcp";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("../lib/api", () => ({
  isDesktopRuntime: () => true,
  api: {
    listProjects: vi.fn().mockResolvedValue([{ id: 1, name: "Project One" }]),
  },
}));
vi.mock("./twofa/TwofaProvider", () => ({
  useTwofa: () => ({
    accounts: [],
    isUnlocked: false,
    status: { has_vault: true },
  }),
}));
vi.mock("./twofa/twofa-lock-dialog", () => ({
  TwofaLockDialog: ({ mode }: { mode: string }) => (
    <div role="dialog">{mode}</div>
  ),
}));
vi.mock("../lib/data-sync", async (original) => ({
  ...(await original<typeof import("../lib/data-sync")>()),
  syncApi: {
    status: vi
      .fn()
      .mockResolvedValue({
        scopes: { projects: true, commands: true, notes: true },
      }),
  },
}));
vi.mock("../lib/mcp", async (original) => ({
  ...(await original<typeof import("../lib/mcp")>()),
  mcpApi: {
    status: vi.fn(),
    clients: vi.fn(),
    bridge: vi.fn(),
    activity: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    settings: vi.fn(),
  },
}));

const client: McpClient = {
  id: "client",
  name: "AI",
  enabled: true,
  token_prefix: "abc",
  project_scope: "selected",
  project_ids: [],
  account_ids: ["granted"],
  permissions: [],
  policy_revision: 1,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  last_used_at: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(mcpApi.status).mockResolvedValue({
    settings: { enabled: false, port: 6811 },
    state: "disabled",
    endpoint: "http://127.0.0.1:6811/mcp",
    error: null,
  });
  vi.mocked(mcpApi.clients).mockResolvedValue([client]);
  vi.mocked(mcpApi.bridge).mockResolvedValue({
    path: "C:/bin/projects-runner-mcp.exe",
    error: null,
    version: "0.7.4",
  });
  vi.mocked(mcpApi.activity).mockResolvedValue({ items: [], has_more: false });
});
afterEach(cleanup);
function setup() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <McpSettingsPanel />
    </QueryClientProvider>,
  );
  return cache;
}
describe("MCP settings", () => {
  it("shows backend state, disables global sync for selected scope and offers vault unlock", async () => {
    setup();
    await screen.findByText("Connection");
    expect(
      screen
        .getByRole("switch", { name: "Enable MCP" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      screen
        .getByRole("switch", { name: "Sync configured data and preferences" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByText("Vault locked · 1 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Unlock vault" }));
    expect(screen.getByRole("dialog").textContent).toBe("unlock");
  });
  it("saves project allowlists with expected revision and waits for backend confirmation", async () => {
    vi.mocked(mcpApi.update).mockResolvedValue({
      ...client,
      project_ids: [1],
      policy_revision: 2,
    });
    setup();
    await screen.findByText("Connection");
    fireEvent.click(screen.getByRole("checkbox", { name: "Project One" }));
    await waitFor(() =>
      expect(mcpApi.update).toHaveBeenCalledWith(
        "client",
        expect.objectContaining({
          project_ids: [1],
          expected_policy_revision: 1,
        }),
      ),
    );
    await screen.findByText("1 selected");
    expect(
      screen
        .getByRole("checkbox", { name: "Project One" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });
  it("reloads a conflicting policy instead of keeping optimistic grants", async () => {
    vi.mocked(mcpApi.update).mockRejectedValue({
      code: "CONFLICT",
      message: "Client policy changed.",
    });
    setup();
    await screen.findByText("Connection");
    fireEvent.click(screen.getByRole("checkbox", { name: "Project One" }));
    await screen.findByText("Client policy changed.");
    expect(mcpApi.clients).toHaveBeenCalledTimes(2);
    expect(
      screen
        .getByRole("checkbox", { name: "Project One" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });
});
