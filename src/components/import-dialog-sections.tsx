import {
  CommandImportDiff,
  NoteImportDiff,
  ProjectFieldChange,
  PrdImportAnalysis,
} from "../lib/api";
import { normalizeCommandScript, runtimeModeLabel } from "../lib/command-utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";

function importStatusVariant(status: "new" | "identical" | "overwrite") {
  if (status === "new") return "success";
  if (status === "overwrite") return "danger";
  return "muted";
}

function importStatusLabel(status: "new" | "identical" | "overwrite") {
  if (status === "new") return "New";
  if (status === "overwrite") return "Overwrite";
  return "Identical";
}

function formatImportValue(value: string | null | undefined) {
  return value?.trim() ? value : "Empty";
}

function formatPorts(ports: number[]) {
  return ports.length > 0 ? ports.map((port) => `:${port}`).join(", ") : "None";
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
        <p className="text-[12px] text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: "new" | "identical" | "overwrite" }) {
  return <Badge variant={importStatusVariant(status)}>{importStatusLabel(status)}</Badge>;
}

function CommandPanel({
  title,
  command,
  status,
  overwriteFields,
}: {
  title: string;
  command: CommandImportDiff["existing"] | CommandImportDiff["incoming"];
  status?: CommandImportDiff["status"];
  overwriteFields?: string[];
}) {
  const script = command ? normalizeCommandScript(command.script) : "";

  return (
    <div className={title === "Incoming" ? "rounded-[6px] border border-primary/35 bg-[var(--vscode-list-active)] p-2.5" : "rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] p-2.5"}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] font-medium uppercase tracking-[0.04em] text-muted-foreground">{title}</span>
        {command ? (
          <strong>
            {command.section} / {command.name}
          </strong>
        ) : (
          <strong>No matching command</strong>
        )}
        {status ? <StatusBadge status={status} /> : null}
      </div>
      {command ? (
        <div className="flex flex-col gap-1 text-[12px] text-muted-foreground">
          <span>{formatPorts(command.ports)}</span>
          <span>{runtimeModeLabel(command.runtime_mode)}</span>
          {command.avatar_label && <span>{command.avatar_label}</span>}
          {overwriteFields && overwriteFields.length > 0 && <span>Changes: {overwriteFields.join(", ")}</span>}
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-[6px] border border-[var(--vscode-border)] bg-[var(--script-preview-bg)] p-2 text-[11px] text-[var(--script-preview-color)]">{script}</pre>
        </div>
      ) : (
        <div className="rounded-[6px] border border-dashed border-[var(--vscode-border)] px-2.5 py-3 text-[12px] text-muted-foreground">This command does not exist yet.</div>
      )}
    </div>
  );
}

function NotePanel({
  title,
  note,
  status,
  overwriteFields,
}: {
  title: string;
  note: NoteImportDiff["existing"] | NoteImportDiff["incoming"];
  status?: NoteImportDiff["status"];
  overwriteFields?: string[];
}) {
  return (
    <div className={title === "Incoming" ? "rounded-[6px] border border-primary/35 bg-[var(--vscode-list-active)] p-2.5" : "rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] p-2.5"}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] font-medium uppercase tracking-[0.04em] text-muted-foreground">{title}</span>
        <strong>{note ? note.id : "No matching note"}</strong>
        {status ? <StatusBadge status={status} /> : null}
      </div>
      {note ? (
        <div className="flex flex-col gap-1 text-[12px] text-muted-foreground">
          <span>{note.pinned ? "Pinned" : "Not pinned"}</span>
          <span>{new Date(note.updatedAt).toLocaleString()}</span>
          {overwriteFields && overwriteFields.length > 0 && <span>Changes: {overwriteFields.join(", ")}</span>}
          <pre className="mt-1 overflow-x-auto rounded-[6px] border border-[var(--vscode-border)] bg-[var(--script-preview-bg)] p-2 text-[11px] text-[var(--script-preview-color)]">{note.content}</pre>
        </div>
      ) : (
        <div className="rounded-[6px] border border-dashed border-[var(--vscode-border)] px-2.5 py-3 text-[12px] text-muted-foreground">This note does not exist yet.</div>
      )}
    </div>
  );
}

function OverwriteCard({
  title,
  fields,
  currentContent,
  incomingContent,
  currentLabel = "Current",
  incomingLabel = "Incoming",
}: {
  title: string;
  fields?: string[];
  currentContent: string;
  incomingContent: string;
  currentLabel?: string;
  incomingLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] p-2.5">
      <strong className="text-[12.5px] text-foreground">{title}</strong>
      {fields && fields.length > 0 ? <span>Fields: {fields.join(", ")}</span> : null}
      <span>{currentLabel}:</span>
      <pre className="overflow-x-auto rounded-[6px] border border-[var(--vscode-border)] bg-[var(--script-preview-bg)] p-2 text-[11px] text-[var(--script-preview-color)]">{currentContent}</pre>
      <span>{incomingLabel}:</span>
      <pre className="overflow-x-auto rounded-[6px] border border-[var(--vscode-border)] bg-[var(--script-preview-bg)] p-2 text-[11px] text-[var(--script-preview-color)]">{incomingContent}</pre>
    </div>
  );
}

export function ImportWizardSummary({ analysis }: { analysis: PrdImportAnalysis }) {
  return (
    <div className="mt-2.5 grid grid-cols-2 gap-2">
      <div className="rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] p-2.5">
        <span className="text-[12px] text-muted-foreground">Current project</span>
        <strong className="block text-[13px] text-foreground">{analysis.existing_project?.name}</strong>
        <small className="block text-[11.5px] text-muted-foreground">{analysis.existing_project?.path}</small>
      </div>
      <div className="rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] p-2.5">
        <span className="text-[12px] text-muted-foreground">.prd file</span>
        <strong className="block text-[13px] text-foreground">{analysis.project_name}</strong>
        <small className="block text-[11.5px] text-muted-foreground">{analysis.project_path}</small>
      </div>
    </div>
  );
}

export function ImportWizardStepper({
  step,
  onBack,
  onNext,
}: {
  step: "commands" | "notes";
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mt-2.5 flex flex-wrap gap-2">
      <Button type="button" variant="ghost" className={step === "commands" ? "min-h-8 rounded-[6px] border border-primary bg-[var(--vscode-list-active)] px-3 py-1.5 text-[12px] font-normal text-primary" : "min-h-8 rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] px-3 py-1.5 text-[12px] font-normal text-muted-foreground"} onClick={onBack}>
        1. Commands
      </Button>
      <Button type="button" variant="ghost" className={step === "notes" ? "min-h-8 rounded-[6px] border border-primary bg-[var(--vscode-list-active)] px-3 py-1.5 text-[12px] font-normal text-primary" : "min-h-8 rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] px-3 py-1.5 text-[12px] font-normal text-muted-foreground"} onClick={onNext}>
        2. Notes
      </Button>
    </div>
  );
}

export function ProjectFieldsSection({
  changes,
  selectedFields,
  onToggleField,
}: {
  changes: ProjectFieldChange[];
  selectedFields: string[];
  onToggleField: (field: string) => void;
}) {
  return (
    <div className="space-y-2">
      <SectionHeader
        title="Project details"
        description="Choose whether to update the current project metadata before importing commands."
      />
      <div className="flex flex-col gap-2">
        {changes.map((change) => {
          const checked = selectedFields.includes(change.field);
          return (
            <label key={change.field} className="flex items-start gap-2.5 rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] p-2.5 hover:border-border-strong">
              <Checkbox checked={checked} onCheckedChange={() => onToggleField(change.field)} className="mt-0.5" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <strong className="text-[12.5px] text-foreground">{change.label}</strong>
                  <Badge variant={change.status === "overwrite" ? "danger" : "success"}>
                    {change.status === "overwrite" ? "Overwrite" : "New"}
                  </Badge>
                </div>
                <div className="grid gap-1 text-[12px] text-muted-foreground sm:grid-cols-2">
                  <div>
                    <span>Current</span>
                    <strong>{formatImportValue(change.existing_value)}</strong>
                  </div>
                  <div>
                    <span>Incoming</span>
                    <strong>{formatImportValue(change.incoming_value)}</strong>
                  </div>
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function CommandDiffSection({
  diffs,
  selectedIndexes,
  onToggleCommand,
}: {
  diffs: CommandImportDiff[];
  selectedIndexes: number[];
  onToggleCommand: (index: number) => void;
}) {
  return (
    <div className="space-y-2">
      <SectionHeader
        title="Commands"
        description="Left is your current project, right is the content from the `.prd` file."
      />
      <div className="flex flex-col gap-2">
        {diffs.map((diff) => {
          const checked = selectedIndexes.includes(diff.index);
          return (
            <label key={`command-${diff.index}`} className="flex flex-col gap-2 rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] p-2.5 hover:border-border-strong">
              <div className="flex items-center gap-2.5">
                <Checkbox checked={checked} onCheckedChange={() => onToggleCommand(diff.index)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-foreground">
                    {diff.incoming.section} / {diff.incoming.name}
                  </div>
                  <div className="text-[11.5px] text-muted-foreground">
                    {diff.status === "overwrite"
                      ? "Incoming command will replace matching fields."
                      : diff.status === "identical"
                        ? "Incoming command already matches the current one."
                        : "Incoming command will be added to this project."}
                  </div>
                </div>
                <StatusBadge status={diff.status} />
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <CommandPanel title="Current" command={diff.existing} />
                <CommandPanel
                  title="Incoming"
                  command={diff.incoming}
                  overwriteFields={diff.overwrite_fields}
                />
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function NoteDiffSection({
  diffs,
  selectedIndexes,
  onToggleNote,
}: {
  diffs: NoteImportDiff[];
  selectedIndexes: number[];
  onToggleNote: (index: number) => void;
}) {
  return (
    <div className="space-y-2">
      <SectionHeader
        title="Notes"
        description="Pick the notes you want to merge in from the `.prd` file."
      />
      <div className="flex flex-col gap-2">
        {diffs.map((diff) => {
          const checked = selectedIndexes.includes(diff.index);
          return (
            <label key={`note-${diff.index}`} className="flex flex-col gap-2 rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] p-2.5 hover:border-border-strong">
              <div className="flex items-center gap-2.5">
                <Checkbox checked={checked} onCheckedChange={() => onToggleNote(diff.index)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-foreground">{diff.incoming.id}</div>
                  <div className="text-[11.5px] text-muted-foreground">
                    {diff.status === "overwrite"
                      ? "Incoming note will replace matching fields."
                      : diff.status === "identical"
                        ? "Incoming note already matches the current one."
                        : "Incoming note will be added to this project."}
                  </div>
                </div>
                <StatusBadge status={diff.status} />
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <NotePanel title="Current" note={diff.existing} />
                <NotePanel
                  title="Incoming"
                  note={diff.incoming}
                  overwriteFields={diff.overwrite_fields}
                />
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function OverwriteProjectFieldsSection({ fields }: { fields: ProjectFieldChange[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[13px] font-semibold text-foreground">Project details</h3>
      <div className="grid gap-2">
        {fields.map((field) => (
          <div key={field.field} className="flex flex-col gap-1 rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] p-2.5">
            <strong>{field.label}</strong>
            <span>Current: {formatImportValue(field.existing_value)}</span>
            <span>Incoming: {formatImportValue(field.incoming_value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OverwriteCommandsSection({ diffs }: { diffs: CommandImportDiff[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[13px] font-semibold text-foreground">Commands</h3>
      <div className="grid gap-2">
        {diffs.map((diff) => (
          <OverwriteCard
            key={`command-overwrite-${diff.index}`}
            title={`${diff.incoming.section} / ${diff.incoming.name}`}
            fields={diff.overwrite_fields}
            currentLabel="Current script"
            incomingLabel="Incoming script"
            currentContent={diff.existing?.script ?? "None"}
            incomingContent={diff.incoming.script}
          />
        ))}
      </div>
    </div>
  );
}

export function OverwriteNotesSection({ diffs }: { diffs: NoteImportDiff[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[13px] font-semibold text-foreground">Notes</h3>
      <div className="grid gap-2">
        {diffs.map((diff) => (
          <OverwriteCard
            key={`note-overwrite-${diff.index}`}
            title={diff.incoming.id}
            fields={diff.overwrite_fields}
            currentContent={diff.existing?.content ?? "None"}
            incomingContent={diff.incoming.content}
          />
        ))}
      </div>
    </div>
  );
}



