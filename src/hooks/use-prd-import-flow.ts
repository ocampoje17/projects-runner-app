import { useState } from "react";
import { api, type ApplyPrdImportRequest, type PrdImportAnalysis } from "../lib/api";
import type {
  ImportLaunchSource,
  ImportWizardState,
  OverwritePreviewState,
} from "../components/project-dialogs";

function createImportWizardState(
  source: ImportLaunchSource,
  analysis: PrdImportAnalysis,
): ImportWizardState {
  return {
    source,
    analysis,
    step: "commands",
    selectedProjectFields: analysis.project_field_changes.map((change) => change.field),
    selectedCommandIndexes: analysis.command_diffs.filter((diff) => diff.default_selected).map((diff) => diff.index),
    selectedNoteIndexes: analysis.note_diffs.filter((diff) => diff.default_selected).map((diff) => diff.index),
  };
}

function buildNewProjectImportRequest(analysis: PrdImportAnalysis): ApplyPrdImportRequest {
  return {
    file_path: analysis.file_path,
    analysis_signature: analysis.analysis_signature,
    target_project_id: null,
    selected_project_fields: [],
    selected_command_indexes: analysis.command_diffs.map((diff) => diff.index),
    selected_note_indexes: analysis.note_diffs.map((diff) => diff.index),
    overwrite_confirmed: true,
  };
}

function toggleSelectedIndex(current: number[], index: number) {
  return current.includes(index)
    ? current.filter((item) => item !== index)
    : [...current, index];
}

function buildWizardImportRequest(
  wizard: ImportWizardState,
  overwriteConfirmed: boolean,
): ApplyPrdImportRequest {
  return {
    file_path: wizard.analysis.file_path,
    analysis_signature: wizard.analysis.analysis_signature,
    target_project_id: wizard.analysis.existing_project?.id ?? null,
    selected_project_fields: wizard.selectedProjectFields,
    selected_command_indexes: wizard.selectedCommandIndexes,
    selected_note_indexes: wizard.selectedNoteIndexes,
    overwrite_confirmed: overwriteConfirmed,
  };
}

export function usePrdImportFlow({
  onApplyImport,
  onError,
}: {
  onApplyImport: (request: ApplyPrdImportRequest) => void;
  onError: (error: unknown) => void;
}) {
  const [newProjectImportAnalysis, setNewProjectImportAnalysis] = useState<{
    source: ImportLaunchSource;
    analysis: PrdImportAnalysis;
  } | null>(null);
  const [importWizard, setImportWizard] = useState<ImportWizardState | null>(null);
  const [overwritePreview, setOverwritePreview] = useState<OverwritePreviewState>(null);

  function resetImportFlow() {
    setNewProjectImportAnalysis(null);
    setImportWizard(null);
    setOverwritePreview(null);
  }

  async function beginImportFromPath(filePath: string, source: ImportLaunchSource) {
    const analysis = await api.analyzePrdFile(filePath);
    if (!analysis.existing_project) {
      if (source === "file_open") {
        onApplyImport(buildNewProjectImportRequest(analysis));
      } else {
        setNewProjectImportAnalysis({ source, analysis });
      }
      return;
    }

    setNewProjectImportAnalysis(null);
    setOverwritePreview(null);
    setImportWizard(createImportWizardState(source, analysis));
  }

  async function pickImportProjectFile() {
    try {
      const preview = await api.pickPrdFile();
      if (preview) {
        await beginImportFromPath(preview.file_path, "manual");
      }
    } catch (error) {
      onError(error);
    }
  }

  function handleImportWizardSubmit() {
    if (!importWizard) {
      return;
    }

    const selectedProjectFields = importWizard.analysis.project_field_changes.filter(
      (change) => importWizard.selectedProjectFields.includes(change.field) && change.status === "overwrite",
    );
    const selectedCommands = importWizard.analysis.command_diffs.filter(
      (diff) => importWizard.selectedCommandIndexes.includes(diff.index) && diff.status === "overwrite",
    );
    const selectedNotes = importWizard.analysis.note_diffs.filter(
      (diff) => importWizard.selectedNoteIndexes.includes(diff.index) && diff.status === "overwrite",
    );

    const request = buildWizardImportRequest(
      importWizard,
      selectedProjectFields.length === 0 && selectedCommands.length === 0 && selectedNotes.length === 0,
    );

    if (selectedProjectFields.length > 0 || selectedCommands.length > 0 || selectedNotes.length > 0) {
      setOverwritePreview({
        request,
        analysis: importWizard.analysis,
        projectFields: selectedProjectFields,
        commands: selectedCommands,
        notes: selectedNotes,
      });
      return;
    }

    onApplyImport(request);
  }

  return {
    newProjectImportAnalysis,
    importWizard,
    overwritePreview,
    resetImportFlow,
    beginImportFromPath,
    pickImportProjectFile,
    importNewProject: (analysis: PrdImportAnalysis) => onApplyImport(buildNewProjectImportRequest(analysis)),
    closeImportPreview: (open: boolean) => {
      if (!open) {
        setNewProjectImportAnalysis(null);
      }
    },
    closeImportWizard: (open: boolean) => {
      if (!open) {
        setImportWizard(null);
        setOverwritePreview(null);
      }
    },
    goImportBack: () => {
      setImportWizard((current) => (current ? { ...current, step: "commands" } : current));
    },
    goImportNext: () => {
      setImportWizard((current) => (current ? { ...current, step: "notes" } : current));
    },
    toggleImportProjectField: (field: string) => {
      setImportWizard((current) =>
        current
          ? {
              ...current,
              selectedProjectFields: current.selectedProjectFields.includes(field)
                ? current.selectedProjectFields.filter((item) => item !== field)
                : [...current.selectedProjectFields, field],
            }
          : current,
      );
    },
    toggleImportCommand: (index: number) => {
      setImportWizard((current) =>
        current
          ? {
              ...current,
              selectedCommandIndexes: toggleSelectedIndex(current.selectedCommandIndexes, index),
            }
          : current,
      );
    },
    toggleImportNote: (index: number) => {
      setImportWizard((current) =>
        current
          ? {
              ...current,
              selectedNoteIndexes: toggleSelectedIndex(current.selectedNoteIndexes, index),
            }
          : current,
      );
    },
    handleImportWizardSubmit,
    closeOverwritePreview: (open: boolean) => {
      if (!open) {
        setOverwritePreview(null);
      }
    },
    confirmOverwritePreview: () => {
      if (!overwritePreview) {
        return;
      }

      onApplyImport({
        ...overwritePreview.request,
        overwrite_confirmed: true,
      });
    },
  };
}
