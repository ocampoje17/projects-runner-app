import type {
  CommandInput,
  PortProcess,
  PrdImportAnalysis,
  Project,
  ProjectCommand,
  ProjectInput,
} from "../lib/api";
import type { InteractiveTerminalKind, InteractiveTerminalOption } from "../lib/interactive-terminal";
import type { ConfirmDialogState } from "./app-shell-types";
import {
  CommandDialog,
  ConfirmDialog,
  ExportProjectDialog,
  ImportProjectDialog,
  ImportWizardDialog,
  type ImportWizardState,
  KillPortsDialog,
  OverwritePreviewDialog,
  type OverwritePreviewState,
  ProjectDialog,
} from "./project-dialogs";

export function AppDialogs({
  editingProject,
  projectDialogOpen,
  onProjectDialogOpenChange,
  projectDialogPending,
  onDeleteProject,
  onProjectError,
  onProjectSubmit,
  commandDialogProject,
  exportProject,
  editingCommand,
  defaultSection,
  availableSections,
  commandDialogPreset,
  commandDialogOpen,
  interactiveTerminalOptions,
  onCommandDialogOpenChange,
  commandDialogPending,
  onCommandError,
  onCommandSubmit,
  exportDialogOpen,
  onExportDialogOpenChange,
  exportDialogPending,
  onExportSave,
  newProjectImportAnalysis,
  importPending,
  onImportNewProject,
  onImportPreviewOpenChange,
  importWizard,
  onImportWizardOpenChange,
  onImportWizardBack,
  onImportWizardNext,
  onImportWizardToggleProjectField,
  onImportWizardToggleCommand,
  onImportWizardToggleNote,
  onImportWizardSubmit,
  overwritePreview,
  onOverwritePreviewOpenChange,
  onOverwritePreviewConfirm,
  confirmDialog,
  onConfirmDialogOpenChange,
  killPortsDialogOpen,
  onKillPortsDialogOpenChange,
  killPortsCommand,
  portProcesses,
  onKillProcesses,
  isKillingPorts,
  onRefreshProcesses,
}: {
  editingProject: Project | null;
  projectDialogOpen: boolean;
  onProjectDialogOpenChange: (open: boolean) => void;
  projectDialogPending: boolean;
  onDeleteProject: (project: Project) => void;
  onProjectError: (error: unknown) => void;
  onProjectSubmit: (input: ProjectInput) => void;
  commandDialogProject: Project | null;
  exportProject: Project | null;
  editingCommand: ProjectCommand | null;
  defaultSection: string | null;
  availableSections: string[];
  commandDialogPreset: {
    interactive_terminal_kind?: InteractiveTerminalKind | null;
    runtime_mode?: CommandInput["runtime_mode"] | null;
  } | null;
  commandDialogOpen: boolean;
  interactiveTerminalOptions: InteractiveTerminalOption[];
  onCommandDialogOpenChange: (open: boolean) => void;
  commandDialogPending: boolean;
  onCommandError: (error: unknown) => void;
  onCommandSubmit: (input: CommandInput) => void;
  exportDialogOpen: boolean;
  onExportDialogOpenChange: (open: boolean) => void;
  exportDialogPending: boolean;
  onExportSave: () => void;
  newProjectImportAnalysis: { source: "manual" | "file_open"; analysis: PrdImportAnalysis } | null;
  importPending: boolean;
  onImportNewProject: (analysis: PrdImportAnalysis) => void;
  onImportPreviewOpenChange: (open: boolean) => void;
  importWizard: ImportWizardState | null;
  onImportWizardOpenChange: (open: boolean) => void;
  onImportWizardBack: () => void;
  onImportWizardNext: () => void;
  onImportWizardToggleProjectField: (field: string) => void;
  onImportWizardToggleCommand: (index: number) => void;
  onImportWizardToggleNote: (index: number) => void;
  onImportWizardSubmit: () => void;
  overwritePreview: OverwritePreviewState;
  onOverwritePreviewOpenChange: (open: boolean) => void;
  onOverwritePreviewConfirm: () => void;
  confirmDialog: ConfirmDialogState;
  onConfirmDialogOpenChange: (open: boolean) => void;
  killPortsDialogOpen: boolean;
  onKillPortsDialogOpenChange: (open: boolean) => void;
  killPortsCommand: ProjectCommand | null;
  portProcesses: PortProcess[];
  onKillProcesses: (pids: number[]) => void | Promise<void>;
  isKillingPorts: boolean;
  onRefreshProcesses: () => void | Promise<void>;
}) {
  return (
    <>
      <ProjectDialog
        key={editingProject?.id ?? "new-project"}
        open={projectDialogOpen}
        project={editingProject}
        isPending={projectDialogPending}
        onDelete={onDeleteProject}
        onError={onProjectError}
        onOpenChange={onProjectDialogOpenChange}
        onSubmit={onProjectSubmit}
      />

      {commandDialogProject && (
        <CommandDialog
          key={`${editingCommand?.id ?? "new-command"}-${defaultSection ?? ""}`}
          command={editingCommand}
          defaultSection={defaultSection}
          availableSections={availableSections}
          interactiveTerminalOptions={interactiveTerminalOptions}
          isPending={commandDialogPending}
          preset={commandDialogPreset}
          open={commandDialogOpen}
          projectId={commandDialogProject.id}
          onError={onCommandError}
          onOpenChange={onCommandDialogOpenChange}
          onSubmit={onCommandSubmit}
        />
      )}

      {exportProject && (
        <ExportProjectDialog
          isPending={exportDialogPending}
          open={exportDialogOpen}
          project={exportProject}
          onOpenChange={onExportDialogOpenChange}
          onSave={onExportSave}
        />
      )}

      <ImportProjectDialog
        isPending={importPending}
        preview={newProjectImportAnalysis?.analysis ?? null}
        onImport={onImportNewProject}
        onOpenChange={onImportPreviewOpenChange}
      />

      <ImportWizardDialog
        wizard={importWizard}
        isPending={importPending}
        onOpenChange={onImportWizardOpenChange}
        onBack={onImportWizardBack}
        onNext={onImportWizardNext}
        onToggleProjectField={onImportWizardToggleProjectField}
        onToggleCommand={onImportWizardToggleCommand}
        onToggleNote={onImportWizardToggleNote}
        onSubmit={onImportWizardSubmit}
      />

      <OverwritePreviewDialog
        preview={overwritePreview}
        isPending={importPending}
        onOpenChange={onOverwritePreviewOpenChange}
        onConfirm={onOverwritePreviewConfirm}
      />

      <ConfirmDialog
        open={confirmDialog.isOpen}
        onOpenChange={onConfirmDialogOpenChange}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmLabel={confirmDialog.confirmLabel}
        cancelLabel={confirmDialog.cancelLabel}
        onConfirm={confirmDialog.onConfirm}
        isDestructive={confirmDialog.isDestructive}
      />

      <KillPortsDialog
        open={killPortsDialogOpen}
        onOpenChange={onKillPortsDialogOpenChange}
        command={killPortsCommand}
        processes={portProcesses}
        onKill={onKillProcesses}
        isKilling={isKillingPorts}
        onRefresh={onRefreshProcesses}
      />
    </>
  );
}
