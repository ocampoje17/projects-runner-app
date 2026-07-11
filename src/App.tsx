import { listen } from "@tauri-apps/api/event";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  api,
  CommandInput,
  isDesktopRuntime,
  Project,
  ProjectCommand,
  ProjectInput,
} from "./lib/api";
import {
  AnimatedToastStack,
  useAnimatedToastStack,
} from "./components/motion/animated-toast-stack";
import { AppDialogs } from "./components/app-dialogs";
import type { ConfirmDialogState } from "./components/app-shell-types";
import { AppWorkspace } from "./components/app-workspace";
import { DEFAULT_SECTION } from "./lib/command-utils";
import { useAppPreferences } from "./hooks/use-app-preferences";
import { useCommandSections } from "./hooks/use-command-sections";
import { useCommandRuntime } from "./hooks/use-command-runtime";
import { usePrdImportFlow } from "./hooks/use-prd-import-flow";
import { useProjectNotes } from "./hooks/use-project-notes";
import { MotionLevelProvider } from "./lib/motion";

type PrdOpenRequestPayload = {
  file_path: string;
};

function App() {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [commandDialogOpen, setCommandDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const {
    theme,
    setTheme,
    accent,
    setAccent,
    terminalFontSize,
    setTerminalFontSize,
    terminalFontFamily,
    setTerminalFontFamily,
    autoClearLogs,
    setAutoClearLogs,
    showLogsTimestamp,
    setShowLogsTimestamp,
    showStreamName,
    setShowStreamName,
    motionLevel,
    setMotionLevel,
  } = useAppPreferences();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editingCommand, setEditingCommand] = useState<ProjectCommand | null>(null);
  const [projectTab, setProjectTab] = useState<"commands" | "notes">("commands");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    isOpen: false,
    title: "",
    description: "",
    onConfirm: () => {},
  });
  const { toasts, showToast, dismissToast } = useAnimatedToastStack({ limit: 4, defaultDuration: 5200 });
  const [defaultSection, setDefaultSection] = useState<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });

  const projects = projectsQuery.data ?? [];
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;

  useEffect(() => {
    document.title = selectedProject ? `${selectedProject.name} - Projects Runner` : "Projects Runner";
  }, [selectedProject]);

  const appInfoQuery = useQuery({
    queryKey: ["app-info"],
    queryFn: api.appInfo,
  });

  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const commandsQuery = useQuery({
    queryKey: ["commands", selectedProject?.id],
    queryFn: () => api.listCommands(selectedProject?.id ?? 0),
    enabled: Boolean(selectedProject),
  });

  const commands = commandsQuery.data ?? [];

  useEffect(() => {
    if (!isDesktopRuntime()) {
      return;
    }

    let mounted = true;

    const hydratePendingPrdRequests = async () => {
      try {
        const filePaths = await api.takePendingPrdOpenRequests();
        for (const filePath of filePaths) {
          if (!mounted) {
            return;
          }
          await beginImportFromPath(filePath, "file_open");
        }
      } catch (error) {
        showError(error);
      }
    };

    void hydratePendingPrdRequests();

    const unlistenPromise = listen<PrdOpenRequestPayload>("prd://open-request", (event) => {
      void beginImportFromPath(event.payload.file_path, "file_open").catch(showError);
    });

    return () => {
      mounted = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const projectMutation = useMutation({
    mutationFn: ({ id, input }: { id?: number; input: ProjectInput }) =>
      id ? api.updateProject(id, input) : api.createProject(input),
    onSuccess: (project, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      setSelectedProjectId(project.id);
      setProjectDialogOpen(false);
      setEditingProject(null);
      showSuccess(variables.id ? "Project updated" : "Project created", project.name);
    },
    onError: showError,
  });

  const projectNotesMutation = useMutation({
    mutationFn: ({ id, input }: { id: number; input: ProjectInput; successTitle: string }) => api.updateProject(id, input),
    onSuccess: (_project, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      showSuccess(variables.successTitle);
    },
    onError: showError,
  });

  const deleteProjectMutation = useMutation({
    mutationFn: api.deleteProject,
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      setSelectedProjectId((current) => (current === id ? null : current));
      showSuccess("Project deleted");
    },
    onError: showError,
  });

  const commandMutation = useMutation({
    mutationFn: ({ id, input }: { id?: number; input: CommandInput }) =>
      id ? api.updateCommand(id, input) : api.createCommand(input),
    onSuccess: (_command, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["commands", selectedProject?.id] });
      setCommandDialogOpen(false);
      setEditingCommand(null);
      showSuccess(variables.id ? "Command updated" : "Command created", variables.input.name);
    },
    onError: showError,
  });

  const deleteCommandMutation = useMutation({
    mutationFn: api.deleteCommand,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["commands", selectedProject?.id] });
      showSuccess("Command deleted");
    },
    onError: showError,
  });

  const exportProjectMutation = useMutation({
    mutationFn: api.exportProject,
    onSuccess: () => {
      setExportDialogOpen(false);
      showSuccess("Project exported", selectedProject?.name);
    },
    onError: showError,
  });

  const importProjectMutation = useMutation({
    mutationFn: api.applyPrdImport,
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["commands"] });
      setSelectedProjectId(project.id);
      resetImportFlow();
      showSuccess("Project imported", project.name);
    },
    onError: showError,
  });

  const {
    sortedProjectNotes,
    newProjectNote,
    setNewProjectNote,
    noteVisibility,
    handleAddProjectNote,
    handleSaveEditedProjectNote,
    handleDeleteProjectNote,
    handleTogglePinnedProjectNote,
    handleToggleProjectNoteVisibility,
  } = useProjectNotes({
    selectedProject,
    onPersist: (projectId, input, successTitle) => {
      projectNotesMutation.mutate({ id: projectId, input, successTitle });
    },
  });

  const {
    commandSections,
    emptySections,
    isAddingSection,
    newSectionName,
    setNewSectionName,
    renamingSection,
    renameSectionValue,
    setRenameSectionValue,
    addSectionInputRef,
    handleAddSectionSubmit,
    handleRenameSection,
    handleDeleteSection,
    startAddSection,
    cancelAddSection,
    startRenameSection,
    cancelRenameSection,
  } = useCommandSections({
    selectedProject,
    commands,
    queryClient,
    onError: showError,
  });

  const {
    runs,
    logs,
    terminalContentByCommandId,
    openLogCommandIds,
    activeLogCommandId,
    setActiveLogCommandId,
    stoppingRunIds,
    restartPendingCommandIds,
    scanningCommandId,
    killPortsCommand,
    portProcesses,
    killPortsDialogOpen,
    setKillPortsDialogOpen,
    killingPorts,
    startCommandRun,
    handleRestartCommand,
    handleKillPortsClick,
    handleKillProcesses,
    handleRefreshProcesses,
    openLogCommandTab,
    stopCommandByCommandId,
    forceStopCommandByCommandId,
    clearCommandLogs,
    closeLogTabNow,
    handleTerminalInput,
    handleTerminalResize,
  } = useCommandRuntime({
    autoClearLogs,
    showLogsTimestamp,
    showStreamName,
    onError: showError,
  });

  const {
    newProjectImportAnalysis,
    importWizard,
    overwritePreview,
    resetImportFlow,
    beginImportFromPath,
    pickImportProjectFile,
    importNewProject,
    closeImportPreview,
    closeImportWizard,
    goImportBack,
    goImportNext,
    toggleImportProjectField,
    toggleImportCommand,
    toggleImportNote,
    handleImportWizardSubmit,
    closeOverwritePreview,
    confirmOverwritePreview,
  } = usePrdImportFlow({
    onApplyImport: (request) => importProjectMutation.mutate(request),
    onError: showError,
  });

  function showError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    showToast({
      status: "error",
      title: "Action failed",
      description: message,
      duration: 6200,
    });
  }

  function showSuccess(title: string, description?: string) {
    showToast({
      status: "success",
      title,
      description,
      duration: 4200,
    });
  }


  function openProjectDialog(project?: Project) {
    setEditingProject(project ?? null);
    setProjectDialogOpen(true);
  }

  function openCommandDialog(command?: ProjectCommand, defaultSectionName?: string) {
    setEditingCommand(command ?? null);
    setDefaultSection(defaultSectionName ?? null);
    setCommandDialogOpen(true);
  }

  const handleCloseTab = (commandId: number) => {
    const command = commands.find((c) => c.id === commandId);
    const cmdName = command ? ` "${command.name}"` : "";
    const run = runs[commandId];
    const isRunning = run && run.status === "running";
    const closesInteractiveSession = command?.runtime_mode === "internal_interactive";

    setConfirmDialog({
      isOpen: true,
      title: "Close Terminal Tab",
      description: isRunning
        ? `Are you sure you want to close the terminal tab${cmdName}? This will stop the running ${closesInteractiveSession ? "interactive session" : "process"}.`
        : `Are you sure you want to close the terminal tab${cmdName}?`,
      confirmLabel: "Close Tab",
      cancelLabel: "Cancel",
      isDestructive: isRunning,
      onConfirm: () => {
        closeLogTabNow(commandId);
      },
    });
  };

  const settingsProps = {
    appInfo: appInfoQuery.data,
    theme,
    setTheme,
    accent,
    setAccent,
    terminalFontSize,
    setTerminalFontSize,
    terminalFontFamily,
    setTerminalFontFamily,
    autoClearLogs,
    setAutoClearLogs,
    showLogsTimestamp,
    setShowLogsTimestamp,
    showStreamName,
    setShowStreamName,
    motionLevel,
    setMotionLevel,
    projectCount: projects.length,
    commandCount: commands.length,
    onResetCache: () => {
      setConfirmDialog({
        isOpen: true,
        title: "Reset Application Cache",
        description: "Are you sure you want to clear all settings, empty sections, and reset the application cache? This will restore defaults.",
        confirmLabel: "Reset Cache",
        cancelLabel: "Cancel",
        isDestructive: true,
        onConfirm: () => {
          localStorage.clear();
          window.location.reload();
        },
      });
    },
  };

  const projectDetailProps = selectedProject
    ? {
        selectedProject,
        projectTab,
        onProjectTabChange: setProjectTab,
        commands,
        commandSections,
        runs,
        logs,
        terminalContentByCommandId,
        openLogCommandIds,
        activeLogCommandId,
        onActiveLogCommandChange: setActiveLogCommandId,
        onClearLogs: (commandId: number) =>
          clearCommandLogs(commandId),
        onCloseLogTab: handleCloseTab,
        onTerminalInput: handleTerminalInput,
        onTerminalResize: handleTerminalResize,
        terminalFontFamily: getComputedStyle(document.documentElement).getPropertyValue("--terminal-font-family").trim() || 'var(--font-mono)',
        terminalFontSize,
        theme,
        renamingSection,
        renameSectionValue,
        onRenameSectionValueChange: setRenameSectionValue,
        onStartRenameSection: startRenameSection,
        onCancelRenameSection: cancelRenameSection,
        onRenameSection: handleRenameSection,
        onDeleteCommand: (command: ProjectCommand) => {
          setConfirmDialog({
            isOpen: true,
            title: "Delete Command",
            description: `Are you sure you want to delete the command "${command.name}"?`,
            confirmLabel: "Delete Command",
            cancelLabel: "Cancel",
            isDestructive: true,
            onConfirm: () => {
              deleteCommandMutation.mutate(command.id);
            },
          });
        },
        onEditCommand: openCommandDialog,
        onKillPorts: handleKillPortsClick,
        onRestartCommand: (command: ProjectCommand) => {
          void handleRestartCommand(command);
        },
        onRunCommand: (command: ProjectCommand) => {
          void startCommandRun(command);
        },
        onStopCommand: (command: ProjectCommand) => {
          stopCommandByCommandId(command.id);
        },
        onForceStopCommand: (command: ProjectCommand) => {
          setConfirmDialog({
            isOpen: true,
            title: "Force stop command",
            description: `Force stop \"${command.name}\" now? This sends an immediate stop request and keeps the command state in sync so you can start it again safely.`,
            confirmLabel: "Force stop",
            cancelLabel: "Cancel",
            isDestructive: true,
            onConfirm: () => forceStopCommandByCommandId(command.id),
          });
        },
        stoppingRunIds,
        restartPendingCommandIds,
        scanningCommandId,
        onOpenLogs: openLogCommandTab,
        onDeleteSection: (section: string) => {
          setConfirmDialog({
            isOpen: true,
            title: "Delete Section",
            description: `Are you sure you want to delete the section "${section}"?`,
            confirmLabel: "Delete Section",
            cancelLabel: "Cancel",
            isDestructive: true,
            onConfirm: () => {
              handleDeleteSection(section);
            },
          });
        },
        isAddingSection,
        newSectionName,
        onNewSectionNameChange: setNewSectionName,
        addSectionInputRef,
        onAddSectionSubmit: handleAddSectionSubmit,
        onStartAddSection: startAddSection,
        onCancelAddSection: cancelAddSection,
        showEmptyCommandsState:
          commands.length === 0 && (emptySections[selectedProject.id] ?? [DEFAULT_SECTION]).length === 0,
        onAddCommand: (section?: string) => openCommandDialog(undefined, section),
        sortedProjectNotes,
        noteVisibility,
        newProjectNote,
        onNewProjectNoteChange: setNewProjectNote,
        onAddProjectNote: handleAddProjectNote,
        onSaveProjectNote: handleSaveEditedProjectNote,
        onTogglePinnedProjectNote: handleTogglePinnedProjectNote,
        onToggleProjectNoteVisibility: handleToggleProjectNoteVisibility,
        onDeleteProjectNote: (noteId: string) => {
          setConfirmDialog({
            isOpen: true,
            title: "Xóa note",
            description: "Bạn có chắc muốn xóa note này không?",
            confirmLabel: "Xóa note",
            cancelLabel: "Hủy",
            isDestructive: true,
            onConfirm: () => handleDeleteProjectNote(noteId),
          });
        },
        isSavingNotes: projectNotesMutation.isPending,
      }
    : undefined;

  return (
    <MotionLevelProvider level={motionLevel}>
      <main className="app-shell grid h-full min-h-0 flex-1 grid-cols-[236px_minmax(0,1fr)] overflow-hidden bg-shell text-foreground">
        <AppWorkspace
          projects={projects}
          selectedProject={selectedProject}
          selectedProjectId={selectedProject?.id ?? null}
          settingsOpen={settingsOpen}
          onAddProject={() => openProjectDialog()}
          onImportProject={pickImportProjectFile}
          onOpenSettings={() => setSettingsOpen(true)}
          onSelectProject={(projectId) => {
            setSettingsOpen(false);
            setSelectedProjectId(projectId);
          }}
          settingsProps={settingsProps}
          onOpenExplorer={() => {
            if (!selectedProject) {
              return;
            }
            void api.showProjectInExplorer(selectedProject.path).catch(showError);
          }}
          onOpenTerminal={() => {
            if (!selectedProject) {
              return;
            }
            void api.openInExternalTerminal(selectedProject.path).catch(showError);
          }}
          onShareProject={() => setExportDialogOpen(true)}
          onEditProject={() => {
            if (selectedProject) {
              openProjectDialog(selectedProject);
            }
          }}
          onAddCommand={() => openCommandDialog()}
          projectDetailProps={projectDetailProps}
        />

        <AppDialogs
          editingProject={editingProject}
          projectDialogOpen={projectDialogOpen}
          onProjectDialogOpenChange={setProjectDialogOpen}
          projectDialogPending={projectMutation.isPending}
          onDeleteProject={(project) => {
            setConfirmDialog({
              isOpen: true,
              title: "Delete Project",
              description: `Are you sure you want to delete "${project.name}"? This action cannot be undone and all associated commands will be permanently removed.`,
              confirmLabel: "Delete Project",
              cancelLabel: "Cancel",
              isDestructive: true,
              onConfirm: () => {
                deleteProjectMutation.mutate(project.id);
                setProjectDialogOpen(false);
              },
            });
          }}
          onProjectError={showError}
          onProjectSubmit={(input) =>
            projectMutation.mutate({
              id: editingProject?.id,
              input: {
                ...input,
                notes: editingProject?.notes ?? null,
              },
            })
          }
          selectedProject={selectedProject}
          editingCommand={editingCommand}
          defaultSection={defaultSection}
          availableSections={commandSections.map((s) => s.section)}
          commandDialogOpen={commandDialogOpen}
          onCommandDialogOpenChange={setCommandDialogOpen}
          commandDialogPending={commandMutation.isPending}
          onCommandError={showError}
          onCommandSubmit={(input) => commandMutation.mutate({ id: editingCommand?.id, input })}
          exportDialogOpen={exportDialogOpen}
          onExportDialogOpenChange={setExportDialogOpen}
          exportDialogPending={exportProjectMutation.isPending}
          onExportSave={() => {
            if (selectedProject) {
              exportProjectMutation.mutate(selectedProject.id);
            }
          }}
          newProjectImportAnalysis={newProjectImportAnalysis}
          importPending={importProjectMutation.isPending}
          onImportNewProject={importNewProject}
          onImportPreviewOpenChange={closeImportPreview}
          importWizard={importWizard}
          onImportWizardOpenChange={closeImportWizard}
          onImportWizardBack={goImportBack}
          onImportWizardNext={goImportNext}
          onImportWizardToggleProjectField={toggleImportProjectField}
          onImportWizardToggleCommand={toggleImportCommand}
          onImportWizardToggleNote={toggleImportNote}
          onImportWizardSubmit={handleImportWizardSubmit}
          overwritePreview={overwritePreview}
          onOverwritePreviewOpenChange={closeOverwritePreview}
          onOverwritePreviewConfirm={confirmOverwritePreview}
          confirmDialog={confirmDialog}
          onConfirmDialogOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, isOpen: open }))}
          killPortsDialogOpen={killPortsDialogOpen}
          onKillPortsDialogOpenChange={setKillPortsDialogOpen}
          killPortsCommand={killPortsCommand}
          portProcesses={portProcesses}
          onKillProcesses={handleKillProcesses}
          isKillingPorts={killingPorts}
          onRefreshProcesses={handleRefreshProcesses}
        />

        <AnimatedToastStack toasts={toasts} onDismiss={dismissToast} position="top-right" placement="fixed" />
      </main>
    </MotionLevelProvider>
  );
}

export default App;






