import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { Loader2, Save } from "lucide-react";
import { z } from "zod";
import { lucideIconValue } from "./entity-avatar";
import { AvatarPicker, FieldError } from "./dialog-shared";
import { Button } from "./ui/button";
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
  DialogToggleCopy,
  DialogToggleRow,
} from "./ui/dialog-form";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";
import { api, CommandInput, ProjectCommand } from "../lib/api";
import { DEFAULT_SECTION, parsePorts, portsToInput } from "../lib/command-utils";

const commandSchema = z.object({
  name: z.string().min(1, "Name is required"),
  script: z.string().min(1, "Script is required"),
  avatar_path: z.string().nullable().optional(),
  ports: z.string().optional(),
  section: z.string().optional(),
  run_in_external_terminal: z.boolean().optional(),
});

type CommandFormValues = z.infer<typeof commandSchema>;

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
      run_in_external_terminal: Boolean(command?.run_in_external_terminal),
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
              run_in_external_terminal: values.run_in_external_terminal ?? false,
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

          <DialogToggleRow className="items-start">
            <DialogToggleCopy >
              <h4>Run via external terminal</h4>
              <p>Launch a new OS terminal window to run this command (useful for interactive CLI tools)</p>
            </DialogToggleCopy>
            <Controller
              control={form.control}
              name="run_in_external_terminal"
              render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />}
            />
          </DialogToggleRow>

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              Save
            </Button>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}


