import { describe, expect, it } from "vitest";
import { clientPolicy, connectionConfig } from "./mcp";
import type { McpClient } from "./mcp";

describe("MCP connection and policy", () => {
  it("quotes Windows paths and keeps tokens in the environment for stdio", () => {
    const config = JSON.parse(
      connectionConfig(
        "stdio",
        "http://127.0.0.1:6811/mcp",
        "TOKEN",
        String.raw`C:\Users\Name Here\projects-runner-mcp.exe`,
      ),
    );
    expect(config.mcpServers["projects-runner"].command).toBe(
      String.raw`C:\Users\Name Here\projects-runner-mcp.exe`,
    );
    expect(config.mcpServers["projects-runner"].args).toEqual([
      "--url",
      "http://127.0.0.1:6811/mcp",
    ]);
    expect(
      config.mcpServers["projects-runner"].env.PROJECTS_RUNNER_MCP_TOKEN,
    ).toBe("TOKEN");
  });
  it("uses a bearer header without exposing the token in the URL", () => {
    const config = JSON.parse(
      connectionConfig("http", "http://127.0.0.1:6811/mcp", "TOKEN"),
    );
    expect(config.mcpServers["projects-runner"].url).not.toContain("TOKEN");
    expect(config.mcpServers["projects-runner"].headers.Authorization).toBe(
      "Bearer TOKEN",
    );
  });
  it("includes the expected revision and only policy fields in updates", () => {
    const c = {
      id: "client",
      name: "AI",
      enabled: true,
      project_scope: "selected",
      permissions: [],
      project_ids: [1],
      account_ids: [],
      policy_revision: 4,
      token_prefix: "redacted",
      last_used_at: null,
    } as unknown as McpClient;
    expect(clientPolicy(c)).toEqual({
      name: "AI",
      enabled: true,
      project_scope: "selected",
      permissions: [],
      project_ids: [1],
      account_ids: [],
      expected_policy_revision: 4,
    });
  });
});
