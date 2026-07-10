import type { ProjectCommand } from "./api";

export const DEFAULT_SECTION = "General";

export function parsePorts(value: string | null | undefined) {
  return (value ?? "")
    .split(/[\s,;]+/)
    .map((part) => Number(part.trim()))
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
}

export function commandPorts(command: ProjectCommand) {
  try {
    const value = JSON.parse(command.ports || "[]");
    return Array.isArray(value) ? value.filter((port) => Number.isInteger(port)) : [];
  } catch {
    return [];
  }
}

export function portsToInput(value: string | null | undefined) {
  return commandPorts({ ports: value ?? "[]" } as ProjectCommand).join(", ");
}
