import { describe, expect, it } from "vitest";
import { getDevIconClass } from "./dev-icons";

describe("dev-icons", () => {
  it("returns appropriate devicon class for known project types", () => {
    expect(getDevIconClass("tauri")).toContain("devicon-tauri-plain");
    expect(getDevIconClass("rust")).toContain("devicon-rust-plain");
    expect(getDevIconClass("node")).toContain("devicon-nodejs-plain");
    expect(getDevIconClass("react")).toContain("devicon-react-original");
    expect(getDevIconClass("vue")).toContain("devicon-vuejs-plain");
    expect(getDevIconClass("python")).toContain("devicon-python-plain");
    expect(getDevIconClass("go")).toContain("devicon-go-original");
    expect(getDevIconClass("dotnet")).toContain("devicon-dot-net-plain");
    expect(getDevIconClass("bun")).toContain("devicon-bun-plain");
    expect(getDevIconClass("deno")).toContain("devicon-denojs-original");
    expect(getDevIconClass("vite")).toContain("devicon-vitejs-plain");
    expect(getDevIconClass("nextjs")).toContain("devicon-nextjs-plain");
  });

  it("handles case insensitivity and whitespace", () => {
    expect(getDevIconClass(" Tauri ")).toContain("devicon-tauri-plain");
    expect(getDevIconClass("RUST")).toContain("devicon-rust-plain");
  });

  it("returns null for unknown type or empty string", () => {
    expect(getDevIconClass("")).toBeNull();
    expect(getDevIconClass("unknown-framework-xyz")).toBeNull();
  });
});
