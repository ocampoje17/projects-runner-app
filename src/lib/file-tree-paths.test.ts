import { describe, expect, it } from "vitest";
import { removePathPrefix, renamePathPrefix } from "./file-tree-paths";

describe("file tree expanded paths", () => {
  it("moves expanded descendants when a folder is renamed", () => {
    expect([...renamePathPrefix(["src", "src/app", "docs"], "src", "source")]).toEqual(["source", "source/app", "docs"]);
  });

  it("removes a deleted folder and all descendants", () => {
    expect([...removePathPrefix(["src", "src/app", "docs"], "src")]).toEqual(["docs"]);
  });
});
