import { Check, FileInput, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { DialogFooter, DialogMetaGrid, DialogMetaItem } from "./ui/dialog-form";
import {
  ApplyPrdImportRequest,
  CommandImportDiff,
  NoteImportDiff,
  PrdImportAnalysis,
  ProjectFieldChange,
} from "../lib/api";
import { DEFAULT_SECTION } from "../lib/command-utils";
import {
  CommandDiffSection,
  ImportWizardStepper,
  ImportWizardSummary,
  NoteDiffSection,
  OverwriteCommandsSection,
  OverwriteNotesSection,
  OverwriteProjectFieldsSection,
  ProjectFieldsSection,
} from "./import-dialog-sections";

export type ImportLaunchSource = "manual" | "file_open";

export type ImportWizardState = {
  source: ImportLaunchSource;
  analysis: PrdImportAnalysis;
  step: "commands" | "notes";
  selectedProjectFields: string[];
  selectedCommandIndexes: number[];
  selectedNoteIndexes: number[];
};

export type OverwritePreviewState = {
  request: ApplyPrdImportRequest;
  analysis: PrdImportAnalysis;
  projectFields: ProjectFieldChange[];
  commands: CommandImportDiff[];
  notes: NoteImportDiff[];
} | null;

export function ImportProjectDialog({
  isPending,
  preview,
  onImport,
  onOpenChange,
}: {
  isPending: boolean;
  preview: PrdImportAnalysis | null;
  onImport: (analysis: PrdImportAnalysis) => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(preview)} onOpenChange={onOpenChange}>
      <DialogContent className="import-preview-dialog">
        <DialogHeader>
          <DialogTitle>Import project</DialogTitle>
          <DialogDescription>Review the .prd file before adding it to the app.</DialogDescription>
        </DialogHeader>
        {preview && (
          <>
            <DialogMetaGrid className="import-details">
              <DialogMetaItem>
                <span>Project</span>
                <strong>{preview.project_name}</strong>
              </DialogMetaItem>
              <DialogMetaItem>
                <span>Folder</span>
                <strong>{preview.project_path}</strong>
              </DialogMetaItem>
              <DialogMetaItem>
                <span>Commands</span>
                <strong>{preview.command_diffs.length}</strong>
              </DialogMetaItem>
              <DialogMetaItem>
                <span>Notes</span>
                <strong>{preview.note_diffs.length}</strong>
              </DialogMetaItem>
              <DialogMetaItem className="col-span-2">
                <span>Sections</span>
                <strong>{preview.sections.length > 0 ? preview.sections.join(", ") : DEFAULT_SECTION}</strong>
              </DialogMetaItem>
            </DialogMetaGrid>
            {preview.description && <p className="project-description preview-description">{preview.description}</p>}
            <DialogFooter>
              <Button onClick={() => onImport(preview)} disabled={isPending}>
                {isPending ? <Loader2 className="spin" size={16} /> : <FileInput size={16} />}
                Import
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ImportWizardDialog({
  wizard,
  isPending,
  onOpenChange,
  onBack,
  onNext,
  onToggleProjectField,
  onToggleCommand,
  onToggleNote,
  onSubmit,
}: {
  wizard: ImportWizardState | null;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onBack: () => void;
  onNext: () => void;
  onToggleProjectField: (field: string) => void;
  onToggleCommand: (index: number) => void;
  onToggleNote: (index: number) => void;
  onSubmit: () => void;
}) {
  const analysis = wizard?.analysis;
  const isCommandsStep = wizard?.step === "commands";

  return (
    <Dialog open={Boolean(wizard)} onOpenChange={onOpenChange}>
      <DialogContent className="wide-dialog import-wizard-dialog">
        <DialogHeader>
          <DialogTitle>Import .prd into existing project</DialogTitle>
          <DialogDescription>
            {analysis?.existing_project
              ? `Compare "${analysis.project_name}" from the .prd file with your current project before importing.`
              : "Review the incoming project contents before importing."}
          </DialogDescription>
        </DialogHeader>
        {analysis && wizard && (
          <>
            <ImportWizardSummary analysis={analysis} />
            <ImportWizardStepper step={wizard.step} onBack={onBack} onNext={onNext} />

            {analysis.project_field_changes.length > 0 && isCommandsStep && (
              <ProjectFieldsSection
                changes={analysis.project_field_changes}
                selectedFields={wizard.selectedProjectFields}
                onToggleField={onToggleProjectField}
              />
            )}

            {isCommandsStep ? (
              <CommandDiffSection
                diffs={analysis.command_diffs}
                selectedIndexes={wizard.selectedCommandIndexes}
                onToggleCommand={onToggleCommand}
              />
            ) : (
              <NoteDiffSection
                diffs={analysis.note_diffs}
                selectedIndexes={wizard.selectedNoteIndexes}
                onToggleNote={onToggleNote}
              />
            )}

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              {wizard.step === "notes" ? (
                <Button type="button" variant="outline" onClick={onBack}>
                  Back to commands
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={onNext}>
                  Continue to notes
                </Button>
              )}
              <Button type="button" onClick={onSubmit} disabled={isPending}>
                {isPending ? <Loader2 className="spin" size={16} /> : <FileInput size={16} />}
                Import selected
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function OverwritePreviewDialog({
  preview,
  isPending,
  onOpenChange,
  onConfirm,
}: {
  preview: OverwritePreviewState;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={Boolean(preview)} onOpenChange={onOpenChange}>
      <DialogContent className="wide-dialog overwrite-preview-dialog">
        <DialogHeader>
          <DialogTitle>Confirm overwrite</DialogTitle>
          <DialogDescription>
            The selected items below will replace existing content in the current project.
          </DialogDescription>
        </DialogHeader>
        {preview && (
          <>
            {preview.projectFields.length > 0 && <OverwriteProjectFieldsSection fields={preview.projectFields} />}
            {preview.commands.length > 0 && <OverwriteCommandsSection diffs={preview.commands} />}
            {preview.notes.length > 0 && <OverwriteNotesSection diffs={preview.notes} />}

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Back
              </Button>
              <Button type="button" variant="danger" onClick={onConfirm} disabled={isPending}>
                {isPending ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
                Confirm overwrite and import
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
