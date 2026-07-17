import type { CommandRuntimeMode, ProjectCommand } from "./api";

export const DEFAULT_SECTION = "General";

export function parsePorts(value: string | null | undefined) {
  return (value ?? "")
    .split(/[\s,;]+/)
    .map((part) => Number(part.trim()))
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
}

export function commandPorts(command: ProjectCommand) {
  const rawValue = command.ports?.trim();
  if (!rawValue) {
    return [];
  }

  try {
    const value = JSON.parse(rawValue);
    if (Array.isArray(value)) {
      return value.filter((port) => Number.isInteger(port));
    }
  } catch {
    // Fall back to plain comma/space-delimited port strings used by some
    // persisted command records and browser preview fixtures.
  }

  return parsePorts(rawValue);
}

export function portsToInput(value: string | null | undefined) {
  return commandPorts({ ports: value ?? "[]" } as ProjectCommand).join(", ");
}

export function normalizeCommandScript(script: string | null | undefined) {
  if (!script) {
    return "";
  }

  if (script.includes("\n") || script.includes("\r")) {
    return script.replace(/\r\n/g, "\n");
  }

  return script.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
}

export function runtimeModeLabel(runtimeMode: CommandRuntimeMode) {
  if (runtimeMode === "external_terminal") {
    return "External terminal";
  }

  if (runtimeMode === "internal_interactive") {
    return "Interactive terminal";
  }

  return "Headless terminal";
}
