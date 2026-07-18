import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { Monitor, Save, SquareTerminal, Terminal, TerminalSquare } from "lucide-react";

import { z } from "zod";
import { lucideIconValue } from "./entity-avatar";
import { AvatarPicker, FieldError } from "./dialog-shared";
import { StatefulButton } from "./ui/stateful-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  DialogField,
  DialogFooter,
  DialogForm,
} from "./ui/dialog-form";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { api, type CommandInput, type CommandRuntimeMode, type ExternalTerminalKind, type ProjectCommand } from "../lib/api";
import { DEFAULT_SECTION, parsePorts, portsToInput } from "../lib/command-utils";
import type { InteractiveTerminalKind, InteractiveTerminalOption } from "../lib/interactive-terminal";

const commandSchema = z.object({
  name: z.string().min(1, "Name is required"),
  script: z.string().min(1, "Script is required"),
  avatar_path: z.string().nullable().optional(),
  ports: z.string().optional(),
  section: z.string().optional(),
  runtime_mode: z.enum(["internal_headless", "internal_interactive", "external_terminal"]),
  external_terminal_kind: z.enum(["default", "windows_terminal", "powershell", "command_prompt", "terminal_app"]).optional(),
  interactive_terminal_kind: z.enum(["cmd", "bash", "powershell", "wsl2", "powershellcore"]).optional(),
});

type CommandFormValues = z.infer<typeof commandSchema>;

const runtimeModeOptions: Array<{
  description: string;
  label: string;
  value: CommandRuntimeMode;
}> = [
  {
    value: "internal_headless",
    label: "Internal headless",
    description: "Run inside the app with streamed output for servers, builds, and test commands.",
  },
  {
    value: "internal_interactive",
    label: "Internal interactive",
    description: "Run inside the app with a full interactive terminal for TUI or keyboard-driven CLI tools.",
  },
  {
    value: "external_terminal",
    label: "External terminal",
    description: "Launch a new OS terminal window and hand execution off to the system terminal.",
  },
];

type TerminalPlatform = "windows" | "macos" | "linux";

type ExternalTerminalOption = {
  description: string;
  icon: typeof Terminal;
  label: string;
  value: ExternalTerminalKind;
};

function detectTerminalPlatform(): TerminalPlatform {
  if (typeof navigator === "undefined") {
    return "windows";
  }

  const platform = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (platform.includes("mac")) {
    return "macos";
  }
  if (platform.includes("linux")) {
    return "linux";
  }
  return "windows";
}

function externalTerminalOptionsForPlatform(platform: TerminalPlatform): ExternalTerminalOption[] {
  if (platform === "macos") {
    return [
      {
        value: "default",
        label: "Default macOS terminal",
        description: "Use the app's default macOS launch behavior and open the command in the standard system terminal flow.",
        icon: TerminalSquare,
      },
      {
        value: "terminal_app",
        label: "Terminal.app",
        description: "Open directly in Apple's built-in Terminal app with your usual shell profile.",
        icon: Monitor,
      },
    ];
  }

  if (platform === "linux") {
    return [
      {
        value: "default",
        label: "Default Linux terminal",
        description: "Use the terminal integration detected from your current Linux desktop environment.",
        icon: TerminalSquare,
      },
    ];
  }

  return [
    {
      value: "default",
      label: "Default Windows terminal",
      description: "Use the app's standard Windows launch behavior and rely on the system's default terminal handling.",
      icon: TerminalSquare,
    },
    {
      value: "windows_terminal",
      label: "Windows Terminal",
      description: "Modern tabbed terminal with PowerShell support, profiles, and better rendering.",
      icon: Monitor,
    },
    {
      value: "powershell",
      label: "PowerShell",
      description: "Open in a classic PowerShell window, useful when you want your PowerShell profile and scripting flow.",
      icon: Terminal,
    },
    {
      value: "command_prompt",
      label: "Command Prompt",
      description: "Open in the classic cmd.exe window, helpful for older batch-based or cmd-specific tooling.",
      icon: SquareTerminal,
    },
  ];
}

export function CommandDialog({
  command,
  defaultSection,
  availableSections = [],
  interactiveTerminalOptions,
  isPending,
  preset,
  open,
  projectId,
  onError,
  onOpenChange,
  onSubmit,
}: {
  command: ProjectCommand | null;
  defaultSection?: string | null;
  availableSections?: string[];
  interactiveTerminalOptions: InteractiveTerminalOption[];
  isPending: boolean;
  preset?: {
    interactive_terminal_kind?: InteractiveTerminalKind | null;
    runtime_mode?: CommandRuntimeMode | null;
  } | null;
  open: boolean;
  projectId: number;
  onError: (error: unknown) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CommandInput) => void;
}) {
  const terminalPlatform = detectTerminalPlatform();
  const externalTerminalOptions = externalTerminalOptionsForPlatform(terminalPlatform);
  const availableSectionsKey = useMemo(() => availableSections.join("||"), [availableSections]);
  const interactiveTerminalOptionsKey = useMemo(
    () => interactiveTerminalOptions.map((option) => option.id).join("||"),
    [interactiveTerminalOptions],
  );

  function getDefaultValues(): CommandFormValues {
    return {
      name: command?.name ?? "",
      script: command?.script ?? "",
      avatar_path: command?.avatar_path ?? null,
      ports: portsToInput(command?.ports),
      section:
        command?.section ??
        defaultSection ??
        (availableSections.includes(DEFAULT_SECTION) ? DEFAULT_SECTION : availableSections[0] ?? DEFAULT_SECTION),
      runtime_mode:
        command?.runtime_mode ??
        preset?.runtime_mode ??
        (command?.run_in_external_terminal ? "external_terminal" : "internal_headless"),
      external_terminal_kind:
        command?.external_terminal_kind ??
        externalTerminalOptions.find((option) => option.value === "default")?.value ??
        externalTerminalOptions[0]?.value,
      interactive_terminal_kind:
        command?.interactive_terminal_kind ??
        preset?.interactive_terminal_kind ??
        interactiveTerminalOptions[0]?.id ??
        "powershell",
    };
  }

  const form = useForm<CommandFormValues>({
    resolver: zodResolver(commandSchema),
    defaultValues: getDefaultValues(),
  });
  const avatar = form.watch("avatar_path");

  const resetSignature = `${command?.id ?? "new"}|${defaultSection ?? ""}|${projectId}|${preset?.runtime_mode ?? ""}|${preset?.interactive_terminal_kind ?? ""}|${availableSectionsKey}|${interactiveTerminalOptionsKey}`;

  useEffect(() => {
    if (!open) {
      return;
    }

    form.reset(getDefaultValues());
  }, [form, open, resetSignature]);

  async function pickAvatar() {
    try {
      const path = await api.pickAndCopyAvatar("command", command?.id);
      if (path) {
        form.setValue("avatar_path", path, { shouldValidate: true });
      }
    } catch (error) {
      onError(error);
    }
  }

  function pickIcon(iconId: string) {
    form.setValue("avatar_path", lucideIconValue(iconId), { shouldValidate: true });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-28px)] w-[min(680px,calc(100vw-20px))] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{command ? "Edit command" : "Add command"}</DialogTitle>
          <DialogDescription>Paste the same multi-line script you would paste into a terminal.</DialogDescription>
        </DialogHeader>
        <DialogForm
          className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden"
          onSubmit={form.handleSubmit((values) =>
            onSubmit({
              project_id: projectId,
              name: values.name,
              script: values.script,
              avatar_path: values.avatar_path ?? null,
              ports: parsePorts(values.ports),
              section: values.section?.trim() || DEFAULT_SECTION,
              order_index: command?.order_index ?? 0,
              runtime_mode: values.runtime_mode,
              run_in_external_terminal: values.runtime_mode === "external_terminal",
              external_terminal_kind:
                values.runtime_mode === "external_terminal" ? (values.external_terminal_kind ?? "default") : null,
              interactive_terminal_kind:
                values.runtime_mode === "internal_interactive" ? (values.interactive_terminal_kind ?? "powershell") : null,
            }),
          )}
        >
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
            <AvatarPicker
              name={form.watch("name") || "Command"}
              avatarPath={avatar}
              onPickImage={pickAvatar}
              onPickIcon={pickIcon}
              className="gap-1.5 p-2.5"
            />
            <DialogField>
              <Label>Name</Label>
              <Input {...form.register("name")} placeholder="Run front-end" />
              <FieldError message={form.formState.errors.name?.message} />
            </DialogField>

            <DialogField>
              <Label>Section</Label>
              <Controller
                control={form.control}
                name="section"
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a section" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableSections.map((sectionName) => (
                        <SelectItem key={sectionName} value={sectionName}>
                          {sectionName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </DialogField>

            <DialogField>
              <Label>Ports</Label>
              <Input {...form.register("ports")} placeholder="3000, 5173, 8080" />
            </DialogField>

            <DialogField>
              <Label>Script</Label>
              <Textarea
                {...form.register("script")}
                className="min-h-[148px] bg-[var(--script-preview-bg)] font-mono text-[11.5px] leading-6 text-[var(--script-preview-color)]"
                rows={8}
                placeholder={"cd frontend\nnpm run dev"}
              />
              <FieldError message={form.formState.errors.script?.message} />
            </DialogField>

            <DialogField>
              <Label>Runtime mode</Label>
              <Controller
                control={form.control}
                name="runtime_mode"
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a runtime mode">
                        {runtimeModeOptions.find((option) => option.value === field.value)?.label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {runtimeModeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value} className="items-start py-2">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[12px] font-medium text-foreground">{option.label}</span>
                            <span className="text-[11px] leading-5 text-muted-foreground">{option.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </DialogField>

            {form.watch("runtime_mode") === "internal_interactive" ? (
              <DialogField>
                <Label>Interactive terminal</Label>
                <Controller
                  control={form.control}
                  name="interactive_terminal_kind"
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select an interactive terminal">
                          {interactiveTerminalOptions.find((option) => option.id === field.value)?.label}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {interactiveTerminalOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id} className="py-2 text-[12px]">
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </DialogField>
            ) : null}

            {form.watch("runtime_mode") === "external_terminal" ? (
              <DialogField>
                <Label>System terminal</Label>
                <Controller
                  control={form.control}
                  name="external_terminal_kind"
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a system terminal">
                          {externalTerminalOptions.find((option) => option.value === field.value)?.label}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {externalTerminalOptions.map((option) => {
                          const Icon = option.icon;
                          return (
                            <SelectItem key={option.value} value={option.value} className="items-start py-2">
                              <div className="flex gap-2">
                                <span className="mt-0.5 text-muted-foreground">
                                  <Icon size={15} />
                                </span>
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[12px] font-medium text-foreground">{option.label}</span>
                                  <span className="text-[11px] leading-5 text-muted-foreground">{option.description}</span>
                                </div>
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  )}
                />
              </DialogField>
            ) : null}
          </div>

          <DialogFooter>
            <StatefulButton
              type="submit"
              state={isPending ? "loading" : "idle"}
              icon={<Save size={16} />}
              loadingText="Saving"
            >
              Save
            </StatefulButton>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}
