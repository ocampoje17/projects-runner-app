import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { Save } from "lucide-react";

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
import { api, type CommandInput, type CommandRuntimeMode, type ProjectCommand } from "../lib/api";
import { DEFAULT_SECTION, parsePorts, portsToInput } from "../lib/command-utils";

const commandSchema = z.object({
  name: z.string().min(1, "Name is required"),
  script: z.string().min(1, "Script is required"),
  avatar_path: z.string().nullable().optional(),
  ports: z.string().optional(),
  section: z.string().optional(),
  runtime_mode: z.enum(["internal_headless", "internal_interactive", "external_terminal"]),
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

export function CommandDialog({
  command,
  defaultSection,
  availableSections = [],
  isPending,
  open,
  projectId,
  onError,
  onOpenChange,
  onSubmit,
}: {
  command: ProjectCommand | null;
  defaultSection?: string | null;
  availableSections?: string[];
  isPending: boolean;
  open: boolean;
  projectId: number;
  onError: (error: unknown) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CommandInput) => void;
}) {
  const form = useForm<CommandFormValues>({
    resolver: zodResolver(commandSchema),
    defaultValues: {
      name: command?.name ?? "",
      script: command?.script ?? "",
      avatar_path: command?.avatar_path ?? null,
      ports: portsToInput(command?.ports),
      section:
        command?.section ??
        defaultSection ??
        (availableSections.includes(DEFAULT_SECTION) ? DEFAULT_SECTION : availableSections[0] ?? DEFAULT_SECTION),
      runtime_mode: command?.runtime_mode ?? (command?.run_in_external_terminal ? "external_terminal" : "internal_headless"),
    },
  });
  const avatar = form.watch("avatar_path");

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
      <DialogContent className="w-[min(680px,calc(100vw-20px))]">
        <DialogHeader>
          <DialogTitle>{command ? "Edit command" : "Add command"}</DialogTitle>
          <DialogDescription>Paste the same multi-line script you would paste into a terminal.</DialogDescription>
        </DialogHeader>
        <DialogForm
          className="flex flex-col gap-2"
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
            }),
          )}
        >
          <AvatarPicker
            name={form.watch("name") || "Command"}
            avatarPath={avatar}
            onPickImage={pickAvatar}
            onPickIcon={pickIcon}
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
              className="min-h-[168px] font-mono text-[12px] leading-relaxed"
              rows={10}
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
                    <SelectValue placeholder="Select a runtime mode" />
                  </SelectTrigger>
                  <SelectContent>
                    {runtimeModeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <div className="grid gap-1 rounded-[14px] border border-border bg-[color-mix(in_oklab,var(--bg-input)_76%,var(--bg-workspace))] p-2.5 text-[11.5px] text-muted-foreground">
              {runtimeModeOptions.map((option) => {
                const isSelected = form.watch("runtime_mode") === option.value;
                return (
                  <div key={option.value} className={isSelected ? "text-foreground" : undefined}>
                    <strong className="block text-[12px]">{option.label}</strong>
                    <span>{option.description}</span>
                  </div>
                );
              })}
            </div>
          </DialogField>

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
