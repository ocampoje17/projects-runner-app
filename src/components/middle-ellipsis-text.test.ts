import { describe, expect, it } from "vitest";
import truncateMiddle from "truncate-middle";

describe("truncate-middle integration", () => {
  it("truncates string in the middle with default behavior and custom ellipsis", () => {
    const text = "my-very-long-project-name-12345";
    const truncated = truncateMiddle(text, 8, 8, "…");
    expect(truncated).toBe("my-very-…me-12345");
  });

  it("truncates file paths preserving root and file extension", () => {
    const filePath = "src/components/views/subviews/deep/MySpecialComponent.tsx";
    const truncated = truncateMiddle(filePath, 14, 20, "…");
    expect(truncated).toBe("src/components…SpecialComponent.tsx");
  });

  it("returns original string if string is shorter than front + back length", () => {
    const shortText = "short-name";
    const result = truncateMiddle(shortText, 10, 10, "…");
    expect(result).toBe("short-name");
  });

  it("handles null, undefined, or empty string gracefully", () => {
    expect(truncateMiddle(null, 5, 5, "…")).toBe("");
    expect(truncateMiddle(undefined, 5, 5, "…")).toBe("");
    expect(truncateMiddle("", 5, 5, "…")).toBe("");
  });

  it("supports ASCII ellipsis '...' as well as unicode '…'", () => {
    const text = "supercalifragilisticexpialidocious";
    const resultAscii = truncateMiddle(text, 5, 5, "...");
    expect(resultAscii).toBe("super...cious");

    const resultUnicode = truncateMiddle(text, 5, 5, "…");
    expect(resultUnicode).toBe("super…cious");
  });
});
