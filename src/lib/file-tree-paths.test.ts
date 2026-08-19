import { describe, expect, it } from "vitest";
import { normalizeProjectRelativePath, removePathPrefix, renamePathPrefix } from "./file-tree-paths";

describe("file tree expanded paths", () => {
  it("moves expanded descendants when a folder is renamed", () => {
    expect([...renamePathPrefix(["src", "src/app", "docs"], "src", "source")]).toEqual(["source", "source/app", "docs"]);
  });

  it("removes a deleted folder and all descendants", () => {
    expect([...removePathPrefix(["src", "src/app", "docs"], "src")]).toEqual(["docs"]);
  });
});

describe("normalizeProjectRelativePath", () => {
  it("normalizes basic relative paths with forward and backward slashes", () => {
    expect(normalizeProjectRelativePath("src/components/button.tsx")).toBe("src/components/button.tsx");
    expect(normalizeProjectRelativePath("src\\components\\button.tsx")).toBe("src/components/button.tsx");
    expect(normalizeProjectRelativePath("/src/components/button.tsx")).toBe("src/components/button.tsx");
    expect(normalizeProjectRelativePath("./src/components/button.tsx")).toBe("src/components/button.tsx");
    expect(normalizeProjectRelativePath("  docs/guide/  ")).toBe("docs/guide");
  });

  it("strips project root prefix from absolute paths", () => {
    const projectRoot = "E:/UserData/Documents/DEV/projects-runner";
    expect(
      normalizeProjectRelativePath("E:\\UserData\\Documents\\DEV\\projects-runner\\src\\App.tsx", projectRoot)
    ).toBe("src/App.tsx");
    expect(
      normalizeProjectRelativePath("e:/userdata/documents/dev/projects-runner/package.json", projectRoot)
    ).toBe("package.json");
    expect(
      normalizeProjectRelativePath("E:/UserData/Documents/DEV/projects-runner/", projectRoot)
    ).toBe("");
  });

  it("handles empty or whitespace strings", () => {
    expect(normalizeProjectRelativePath("")).toBe("");
    expect(normalizeProjectRelativePath("   ")).toBe("");
  });
});

