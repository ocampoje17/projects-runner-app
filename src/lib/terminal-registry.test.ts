import { describe, expect, it, vi } from "vitest";
import {
  clearRegisteredTerminal,
  publishTerminalOutput,
  registerTerminalController,
  removeRegisteredTerminal,
  type RegisteredTerminalController,
} from "./terminal-registry";

function controller(): RegisteredTerminalController {
  return {
    clear: vi.fn(),
    copySelection: vi.fn(async () => true),
    focus: vi.fn(),
    hasSelection: vi.fn(() => true),
    pasteFromClipboard: vi.fn(async () => undefined),
    selectAll: vi.fn(),
    write: vi.fn(),
  };
}

describe("terminal registry", () => {
  it("flushes output that arrives before the terminal mounts", () => {
    const terminalId = 91_001;
    publishTerminalOutput(terminalId, "before ");
    publishTerminalOutput(terminalId, "mount");
    const target = controller();

    const unregister = registerTerminalController(terminalId, target);

    expect(target.write).toHaveBeenCalledOnce();
    expect(target.write).toHaveBeenCalledWith("before mount");
    unregister();
    removeRegisteredTerminal(terminalId);
  });

  it("streams mounted output directly and clears through the controller", () => {
    const terminalId = 91_002;
    const target = controller();
    const unregister = registerTerminalController(terminalId, target);

    publishTerminalOutput(terminalId, "chunk");
    clearRegisteredTerminal(terminalId);

    expect(target.write).toHaveBeenCalledWith("chunk");
    expect(target.clear).toHaveBeenCalledOnce();
    unregister();
    removeRegisteredTerminal(terminalId);
  });

  it("does not let an old unregister remove a replacement controller", () => {
    const terminalId = 91_003;
    const first = controller();
    const second = controller();
    const unregisterFirst = registerTerminalController(terminalId, first);
    const unregisterSecond = registerTerminalController(terminalId, second);

    unregisterFirst();
    publishTerminalOutput(terminalId, "latest");

    expect(second.write).toHaveBeenCalledWith("latest");
    unregisterSecond();
    removeRegisteredTerminal(terminalId);
  });

  it("bounds output buffered before mount", () => {
    const terminalId = 91_004;
    publishTerminalOutput(terminalId, "a".repeat(600 * 1024));
    const target = controller();

    const unregister = registerTerminalController(terminalId, target);
    const buffered = vi.mocked(target.write).mock.calls[0][0];

    expect(buffered.length).toBe(512 * 1024);
    unregister();
    removeRegisteredTerminal(terminalId);
  });
});
