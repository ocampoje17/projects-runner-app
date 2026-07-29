const MAX_PENDING_TERMINAL_BYTES = 512 * 1024;

export type RegisteredTerminalController = {
  clear: () => void;
  copySelection: () => Promise<boolean>;
  focus: () => void;
  hasSelection: () => boolean;
  pasteFromClipboard: () => Promise<void>;
  selectAll: () => void;
  write: (data: string) => void;
};

const controllers = new Map<number, RegisteredTerminalController>();
const pendingOutput = new Map<number, string>();

function trimPendingOutput(value: string) {
  if (value.length <= MAX_PENDING_TERMINAL_BYTES) {
    return value;
  }
  return value.slice(value.length - MAX_PENDING_TERMINAL_BYTES);
}

export function registerTerminalController(
  terminalId: number,
  controller: RegisteredTerminalController,
) {
  controllers.set(terminalId, controller);
  const pending = pendingOutput.get(terminalId);
  if (pending) {
    controller.write(pending);
    pendingOutput.delete(terminalId);
  }

  return () => {
    if (controllers.get(terminalId) === controller) {
      controllers.delete(terminalId);
    }
  };
}

export function getTerminalController(terminalId: number) {
  return controllers.get(terminalId);
}

export function publishTerminalOutput(terminalId: number, data: string) {
  const controller = controllers.get(terminalId);
  if (controller) {
    controller.write(data);
    return;
  }

  pendingOutput.set(
    terminalId,
    trimPendingOutput(`${pendingOutput.get(terminalId) ?? ""}${data}`),
  );
}

export function clearRegisteredTerminal(terminalId: number) {
  pendingOutput.delete(terminalId);
  controllers.get(terminalId)?.clear();
}

export function removeRegisteredTerminal(terminalId: number) {
  pendingOutput.delete(terminalId);
  controllers.delete(terminalId);
}
