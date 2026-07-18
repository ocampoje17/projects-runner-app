export type InteractiveTerminalKind = "cmd" | "bash" | "powershell" | "wsl2" | "powershellcore";

export type InteractiveTerminalOption = {
  description: string;
  id: InteractiveTerminalKind;
  label: string;
};

export const FALLBACK_WINDOWS_INTERACTIVE_TERMINAL_OPTIONS: InteractiveTerminalOption[] = [
  {
    id: "cmd",
    label: "cmd",
    description: "Classic Windows Command Prompt.",
  },
  {
    id: "bash",
    label: "bash",
    description: "Bash shell detected from your Windows environment.",
  },
  {
    id: "powershell",
    label: "powershell",
    description: "Windows PowerShell with the app's interactive terminal.",
  },
  {
    id: "wsl2",
    label: "wsl2",
    description: "Run the command inside the default WSL distribution.",
  },
  {
    id: "powershellcore",
    label: "powershellcore",
    description: "PowerShell Core (`pwsh`) if installed.",
  },
];

export function interactiveTerminalLabel(kind: InteractiveTerminalKind) {
  return FALLBACK_WINDOWS_INTERACTIVE_TERMINAL_OPTIONS.find((option) => option.id === kind)?.label ?? kind;
}
