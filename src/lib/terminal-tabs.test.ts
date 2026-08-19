import { describe, expect, it } from "vitest";
import { orderOpenedItems, partitionTerminalIds, terminalCloseAction } from "./terminal-tabs";

describe("terminal tab behavior", () => {
  it("uses opening order and does not reorder an existing tab", () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(orderOpenedItems(items, [3, 1, 2]).map((item) => item.id)).toEqual([3, 1, 2]);
    expect(orderOpenedItems(items, [3, 1, 2]).map((item) => item.id)).toEqual([3, 1, 2]);
  });

  it("partitions close-all into idle tabs to close and running tabs to stop", () => {
    expect(partitionTerminalIds([1, 2, 3], (id) => id === 2)).toEqual({ runningIds: [2], idleIds: [1, 3] });
  });

  it("closes idle tabs immediately and confirms before stopping running tabs", () => {
    expect(terminalCloseAction(false, false)).toBe("close");
    expect(terminalCloseAction(true, false)).toBe("confirm-stop");
    expect(terminalCloseAction(true, true)).toBe("ignore");
  });
});
