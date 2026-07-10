import {
  CommandImportDiff,
  NoteImportDiff,
  ProjectFieldChange,
  PrdImportAnalysis,
} from "../lib/api";
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
    <div className="import-pane-header">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
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
  return (
    <div className={`import-diff-panel ${title === "Incoming" ? "incoming" : ""}`.trim()}>
      <div className="import-card-head">
        <span>{title}</span>
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
        <div className="import-card-body">
          <span>{formatPorts(command.ports)}</span>
          <span>{command.run_in_external_terminal ? "External terminal" : "Inline terminal"}</span>
          {command.avatar_label && <span>{command.avatar_label}</span>}
          {overwriteFields && overwriteFields.length > 0 && <span>Changes: {overwriteFields.join(", ")}</span>}
          <pre>{command.script}</pre>
        </div>
      ) : (
        <div className="import-card-empty">This command does not exist yet.</div>
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
    <div className={`import-diff-panel ${title === "Incoming" ? "incoming" : ""}`.trim()}>
      <div className="import-card-head">
        <span>{title}</span>
        <strong>{note ? note.id : "No matching note"}</strong>
        {status ? <StatusBadge status={status} /> : null}
      </div>
      {note ? (
        <div className="import-card-body">
          <span>{note.pinned ? "Pinned" : "Not pinned"}</span>
          <span>{new Date(note.updatedAt).toLocaleString()}</span>
          {overwriteFields && overwriteFields.length > 0 && <span>Changes: {overwriteFields.join(", ")}</span>}
          <pre>{note.content}</pre>
        </div>
      ) : (
        <div className="import-card-empty">This note does not exist yet.</div>
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
    <div className="overwrite-card">
      <strong>{title}</strong>
      {fields && fields.length > 0 ? <span>Fields: {fields.join(", ")}</span> : null}
      <span>{currentLabel}:</span>
      <pre>{currentContent}</pre>
      <span>{incomingLabel}:</span>
      <pre>{incomingContent}</pre>
    </div>
  );
}

export function ImportWizardSummary({ analysis }: { analysis: PrdImportAnalysis }) {
  return (
    <div className="import-wizard-summary mt-2.5 grid grid-cols-2 gap-2">
      <div>
        <span>Current project</span>
        <strong>{analysis.existing_project?.name}</strong>
        <small>{analysis.existing_project?.path}</small>
      </div>
      <div>
        <span>.prd file</span>
        <strong>{analysis.project_name}</strong>
        <small>{analysis.project_path}</small>
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
    <div className="import-wizard-stepper">
      <Button type="button" variant="ghost" className={`import-step ${step === "commands" ? "active" : ""}`} onClick={onBack}>
        1. Commands
      </Button>
      <Button type="button" variant="ghost" className={`import-step ${step === "notes" ? "active" : ""}`} onClick={onNext}>
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
    <div className="import-project-fields">
      <SectionHeader
        title="Project details"
        description="Choose whether to update the current project metadata before importing commands."
      />
      <div className="import-field-list flex flex-col gap-2">
        {changes.map((change) => {
          const checked = selectedFields.includes(change.field);
          return (
            <label key={change.field} className="import-field-item flex items-start gap-2 rounded-[12px] border border-app-border p-2.5">
              <Checkbox checked={checked} onCheckedChange={() => onToggleField(change.field)} />
              <div className="import-field-copy">
                <div className="import-field-row">
                  <strong>{change.label}</strong>
                  <Badge variant={change.status === "overwrite" ? "danger" : "success"}>
                    {change.status === "overwrite" ? "Overwrite" : "New"}
                  </Badge>
                </div>
                <div className="import-field-diff">
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
    <div className="import-diff-layout">
      <SectionHeader
        title="Commands"
        description="Left is your current project, right is the content from the `.prd` file."
      />
      <div className="import-diff-list flex flex-col gap-2">
        {diffs.map((diff) => {
          const checked = selectedIndexes.includes(diff.index);
          return (
            <label key={`command-${diff.index}`} className="import-diff-item flex items-start gap-2 rounded-[12px] border border-app-border p-2.5">
              <Checkbox checked={checked} onCheckedChange={() => onToggleCommand(diff.index)} />
              <div className="import-diff-panels">
                <CommandPanel title="Current" command={diff.existing} />
                <CommandPanel
                  title="Incoming"
                  command={diff.incoming}
                  status={diff.status}
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
    <div className="import-diff-layout">
      <SectionHeader
        title="Notes"
        description="Pick the notes you want to merge in from the `.prd` file."
      />
      <div className="import-diff-list flex flex-col gap-2">
        {diffs.map((diff) => {
          const checked = selectedIndexes.includes(diff.index);
          return (
            <label key={`note-${diff.index}`} className="import-diff-item flex items-start gap-2 rounded-[12px] border border-app-border p-2.5">
              <Checkbox checked={checked} onCheckedChange={() => onToggleNote(diff.index)} />
              <div className="import-diff-panels">
                <NotePanel title="Current" note={diff.existing} />
                <NotePanel
                  title="Incoming"
                  note={diff.incoming}
                  status={diff.status}
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
    <div className="overwrite-section">
      <h3>Project details</h3>
      <div className="overwrite-grid">
        {fields.map((field) => (
          <div key={field.field} className="overwrite-card">
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
    <div className="overwrite-section">
      <h3>Commands</h3>
      <div className="overwrite-grid">
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
    <div className="overwrite-section">
      <h3>Notes</h3>
      <div className="overwrite-grid">
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

