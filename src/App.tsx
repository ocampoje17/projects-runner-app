import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import {
  api,
  CommandInput,
  isDesktopRuntime,
  Project,
  ProjectCommand,
  ProjectInput,
} from "./lib/api";
import {
  FALLBACK_WINDOWS_INTERACTIVE_TERMINAL_OPTIONS,
  type InteractiveTerminalKind,
} from "./lib/interactive-terminal";
import {
  AnimatedToastStack,
  useAnimatedToastStack,
} from "./components/motion/animated-toast-stack";
import { AppDialogs } from "./components/app-dialogs";
import type { ConfirmDialogState } from "./components/app-shell-types";
import { TitlebarSearch } from "./components/titlebar-search";
import { VSCodeShell, type VSCodeShellHandle } from "./components/vscode-shell";
import { resolveTerminalFontFamilyValue, useAppPreferences } from "./hooks/use-app-preferences";
import { useCommandSections } from "./hooks/use-command-sections";
import { useCommandRuntime } from "./hooks/use-command-runtime";
import { usePrdImportFlow } from "./hooks/use-prd-import-flow";
import { useProjectNotes } from "./hooks/use-project-notes";
import { useAppUpdater } from "./hooks/use-app-updater";
import { buildTitlebarSearchCollections, type TitlebarSearchItem } from "./lib/titlebar-search";
import { MotionLevelProvider } from "./lib/motion";
import appIcon from "./assets/app-icon.png";
import { UpdateDialog } from "./components/update-dialog";

type PrdOpenRequestPayload = {
  file_path: string;
};

type AppContextMenuItem = {
  label: string;
  onSelect: () => void | Promise<void>;
  disabled?: boolean;
  tone?: "default" | "danger";
};

function AppContextMenu({
  menuState,
  onClose,
}: {
  menuState: {
    x: number;
    y: number;
    items: AppContextMenuItem[];
  } | null;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuState) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    function handleViewportChange() {
      onClose();
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("blur", handleViewportChange);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("blur", handleViewportChange);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [menuState, onClose]);

  if (!menuState) {
    return null;
  }

  const menuWidth = 200;
  const menuHeight = menuState.items.length * 34 + 8;
  const left = Math.max(8, Math.min(menuState.x, window.innerWidth - menuWidth - 8));
  const top = Math.max(8, Math.min(menuState.y, window.innerHeight - menuHeight - 8));

  return (
    <div
      ref={menuRef}
      className="fixed z-[4000] min-w-[200px] overflow-hidden rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] p-1 shadow-[var(--split-menu-shadow)]"
      style={
        {
          left,
          top,
        } as CSSProperties
      }
    >
      {menuState.items.map((item) => (
        <button
          key={item.label}
          type="button"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) {
              return;
            }
            onClose();
            void item.onSelect();
          }}
          className={[
            "flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12px] text-[var(--vscode-foreground)] transition-[background-color,color]",
            "hover:bg-[var(--vscode-list-hover)] hover:text-foreground active:bg-[var(--vscode-list-active)] disabled:cursor-not-allowed disabled:opacity-50",
            item.tone === "danger"
              ? "text-[var(--vscode-danger)] hover:bg-[color-mix(in_srgb,var(--vscode-danger)_14%,transparent)] hover:text-[var(--vscode-danger)] active:bg-[color-mix(in_srgb,var(--vscode-danger)_22%,transparent)]"
              : "",
          ].join(" ")}
        >
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function AppTitleBar({
  selectedProjectName,
  searchCollections,
  onSearchSelect,
}: {
  selectedProjectName: string | null;
  searchCollections: ReturnType<typeof buildTitlebarSearchCollections>;
  onSearchSelect: (item: TitlebarSearchItem) => void;
}) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFocused, setIsFocused] = useState(true);

  useEffect(() => {
    if (!isDesktopRuntime()) {
      return;
    }

    const currentWindow = getCurrentWindow();
    void currentWindow.isMaximized().then(setIsMaximized).catch(() => {});
    void currentWindow.isFocused().then(setIsFocused).catch(() => {});
    void currentWindow.setDecorations(false).catch(() => {});

    let unlistenResize: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;

    void currentWindow
      .onResized(async () => {
        try {
          setIsMaximized(await currentWindow.isMaximized());
        } catch {
          // Ignore desktop window state sync failures.
        }
      })
      .then((unlisten) => {
        unlistenResize = unlisten;
      });

    void currentWindow
      .onFocusChanged(({ payload }) => {
        setIsFocused(payload);
      })
      .then((unlisten) => {
        unlistenFocus = unlisten;
      });

    return () => {
      unlistenResize?.();
      unlistenFocus?.();
    };
  }, []);

  const projectLabel = selectedProjectName ? `Workspace: ${selectedProjectName}` : "No workspace selected";

  function toggleWindowMaximize() {
    if (!isDesktopRuntime()) {
      return;
    }
    void getCurrentWindow().toggleMaximize().catch(() => {});
  }

  function isWindowControlTarget(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest("[data-window-control='true'], [data-titlebar-interactive='true']"));
  }

  return (
    <header
      className="relative flex h-9 shrink-0 items-stretch border-b border-[var(--vscode-border)] bg-[var(--vscode-activity)] text-foreground select-none"
      onMouseDown={(event) => {
        if (!isDesktopRuntime() || event.button !== 0 || isWindowControlTarget(event.target)) {
          return;
        }
        void getCurrentWindow().startDragging().catch(() => {});
      }}
      onDoubleClick={(event) => {
        if (isWindowControlTarget(event.target)) {
          return;
        }
        toggleWindowMaximize();
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 px-3">
        <img src={appIcon} alt="" className="h-4 w-4 shrink-0 rounded-[4px]" draggable={false} />
        <div className="hidden shrink-0 truncate text-[12px] font-medium text-foreground md:block">Projects Runner</div>
        <div className="flex min-w-0 flex-1 justify-center">
          <TitlebarSearch collections={searchCollections} onSelect={onSearchSelect} />
        </div>
        <div className="hidden min-w-0 max-w-[28%] shrink truncate text-[11px] text-[var(--vscode-foreground)]/60 xl:block">
          {projectLabel}
        </div>
      </div>
      <div className="relative z-10 flex shrink-0 items-stretch">
        <button
          data-window-control="true"
          type="button"
          className="flex h-9 w-12 items-center justify-center border-l border-transparent text-[var(--vscode-icon)] transition-[background-color,color,border-color] hover:border-[var(--vscode-border)] hover:bg-[var(--vscode-list-hover)] hover:text-foreground active:bg-[var(--vscode-list-active)]"
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
          }}
          onClick={() => {
            if (isDesktopRuntime()) {
              void getCurrentWindow().minimize().catch(() => {});
            }
          }}
          aria-label="Minimize window"
        >
          <Minus size={14} />
        </button>
        <button
          data-window-control="true"
          type="button"
          className="flex h-9 w-12 items-center justify-center border-l border-transparent text-[var(--vscode-icon)] transition-[background-color,color,border-color] hover:border-[var(--vscode-border)] hover:bg-[var(--vscode-list-hover)] hover:text-foreground active:bg-[var(--vscode-list-active)]"
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
          }}
          onClick={() => {
            toggleWindowMaximize();
          }}
          aria-label={isMaximized ? "Restore window" : "Maximize window"}
        >
          {isMaximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button
          data-window-control="true"
          type="button"
          className="flex h-9 w-12 items-center justify-center border-l border-transparent text-[var(--vscode-icon)] transition-[background-color,color,border-color] hover:border-[color-mix(in_srgb,var(--vscode-danger)_40%,transparent)] hover:bg-[var(--vscode-danger)] hover:text-white active:bg-[color-mix(in_srgb,var(--vscode-danger)_78%,black)]"
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
          }}
          onClick={() => {
            if (isDesktopRuntime()) {
              void getCurrentWindow().close().catch(() => {});
            }
          }}
          aria-label="Close window"
        >
          <X size={14} />
        </button>
      </div>
      {!isFocused ? <div className="pointer-events-none absolute inset-0 bg-black/8" /> : null}
    </header>
  );
}

function App() {
  const queryClient = useQueryClient();
  const shellRef = useRef<VSCodeShellHandle | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: AppContextMenuItem[];
  } | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [commandDialogOpen, setCommandDialogOpen] = useState(false);
  const {
    theme,
    setTheme,
    resolvedTheme,
    accent,
    setAccent,
    dateFormat,
    setDateFormat,
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
  const [commandDialogProjectId, setCommandDialogProjectId] = useState<number | null>(null);
  const [commandDialogPreset, setCommandDialogPreset] = useState<{
    interactive_terminal_kind?: InteractiveTerminalKind | null;
    runtime_mode?: CommandInput["runtime_mode"] | null;
  } | null>(null);
  const [exportProjectId, setExportProjectId] = useState<number | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    isOpen: false,
    title: "",
    description: "",
    onConfirm: () => {},
  });
  const { toasts, showToast, dismissToast } = useAnimatedToastStack({ limit: 4, defaultDuration: 5200 });
  const [defaultSection, setDefaultSection] = useState<string | null>(null);
  const appUpdater = useAppUpdater();

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });

  const projects = projectsQuery.data ?? [];
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;
  const commandDialogProject = projects.find((project) => project.id === commandDialogProjectId) ?? null;
  const exportProject = projects.find((project) => project.id === exportProjectId) ?? null;

  useEffect(() => {
    document.title = selectedProject ? `${selectedProject.name} - Projects Runner` : "Projects Runner";
  }, [selectedProject]);

  const appInfoQuery = useQuery({
    queryKey: ["app-info"],
    queryFn: api.appInfo,
  });
  const interactiveTerminalOptionsQuery = useQuery({
    queryKey: ["interactive-terminal-options"],
    queryFn: api.listInteractiveTerminalOptions,
    enabled: isDesktopRuntime(),
  });

  useEffect(() => {
    if (selectedProjectId === null && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    function isEditableTarget(target: HTMLElement) {
      return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable ||
        Boolean(target.closest("[contenteditable='true']"))
      );
    }

    function hasSelection(target: HTMLElement) {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return (target.selectionEnd ?? 0) > (target.selectionStart ?? 0);
      }

      const selection = window.getSelection();
      return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
    }

    async function pasteIntoTarget(target: HTMLElement) {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const clipboardText = await navigator.clipboard.readText();
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? start;
        const nextValue = `${target.value.slice(0, start)}${clipboardText}${target.value.slice(end)}`;
        target.value = nextValue;
        const nextCursor = start + clipboardText.length;
        target.setSelectionRange(nextCursor, nextCursor);
        target.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }

      target.focus();
      try {
        const clipboardText = await navigator.clipboard.readText();
        if (!document.execCommand("insertText", false, clipboardText)) {
          document.execCommand("paste");
        }
      } catch {
        document.execCommand("paste");
      }
    }

    async function copySelection(target: HTMLElement) {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const start = target.selectionStart ?? 0;
        const end = target.selectionEnd ?? 0;
        const text = target.value.slice(start, end);
        if (!text) {
          return;
        }
        await navigator.clipboard.writeText(text);
        return;
      }

      const text = window.getSelection()?.toString() ?? "";
      if (!text.trim()) {
        return;
      }
      await navigator.clipboard.writeText(text);
    }

    async function cutSelection(target: HTMLElement) {
      await copySelection(target);
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const start = target.selectionStart ?? 0;
        const end = target.selectionEnd ?? 0;
        target.setRangeText("", start, end, "start");
        target.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      document.execCommand("delete");
    }

    function selectAllTarget(target: HTMLElement) {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.focus();
        target.select();
        return;
      }
      document.execCommand("selectAll");
    }

    function buildContextMenuItems(target: HTMLElement) {
      const editable = isEditableTarget(target);
      const selected = hasSelection(target);
      const readOnly =
        (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && target.readOnly;

      const items: AppContextMenuItem[] = [];

      if (editable) {
        items.push(
          {
            label: "Cut",
            onSelect: () => cutSelection(target),
            disabled: !selected || readOnly,
          },
          {
            label: "Copy",
            onSelect: () => copySelection(target),
            disabled: !selected,
          },
          {
            label: "Paste",
            onSelect: () => pasteIntoTarget(target),
            disabled: readOnly,
          },
          {
            label: "Select All",
            onSelect: () => selectAllTarget(target),
          },
        );
      } else {
        items.push(
          {
            label: "Copy",
            onSelect: () => copySelection(target),
            disabled: !selected,
          },
          {
            label: "Reload",
            onSelect: () => window.location.reload(),
          },
          {
            label: "Select All",
            onSelect: () => selectAllTarget(target),
          },
        );
      }

      return items;
    }

    function handleContextMenu(event: MouseEvent) {
      if (event.defaultPrevented) {
        return;
      }

      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) {
        return;
      }

      event.preventDefault();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        items: buildContextMenuItems(target),
      });
    }

    window.addEventListener("contextmenu", handleContextMenu);
    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);

  useEffect(() => {
    if (!commandDialogOpen) {
      return;
    }
    if (commandDialogProject || editingCommand) {
      return;
    }

    setCommandDialogOpen(false);
    setCommandDialogProjectId(null);
    setEditingCommand(null);
    setDefaultSection(null);
    setCommandDialogPreset(null);
  }, [commandDialogOpen, commandDialogProject, editingCommand]);

  useEffect(() => {
    if (!exportDialogOpen || exportProject) {
      return;
    }

    setExportDialogOpen(false);
    setExportProjectId(null);
  }, [exportDialogOpen, exportProject]);

  const commandQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ["commands", project.id],
      queryFn: () => api.listCommands(project.id),
      enabled: true,
    })),
  });

  const commandsByProjectId = useMemo(
    () =>
      projects.reduce<Record<number, ProjectCommand[]>>((acc, project, index) => {
        acc[project.id] = commandQueries[index]?.data ?? [];
        return acc;
      }, {}),
    [commandQueries, projects],
  );

  const allCommands = useMemo(() => Object.values(commandsByProjectId).flat(), [commandsByProjectId]);

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
      setCommandDialogProjectId((current) => (current === id ? null : current));
      setExportProjectId((current) => (current === id ? null : current));
      setEditingProject((current) => (current?.id === id ? null : current));
      setEditingCommand((current) => (current?.project_id === id ? null : current));
      showSuccess("Project deleted");
    },
    onError: showError,
  });

  const commandMutation = useMutation({
    mutationFn: ({ id, input }: { id?: number; input: CommandInput }) =>
      id ? api.updateCommand(id, input) : api.createCommand(input),
    onSuccess: (_command, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["commands", variables.input.project_id] });
      setCommandDialogOpen(false);
      setEditingCommand(null);
      setCommandDialogProjectId(null);
      setDefaultSection(null);
      showSuccess(variables.id ? "Command updated" : "Command created", variables.input.name);
    },
    onError: showError,
  });

  const deleteCommandMutation = useMutation({
    mutationFn: ({ commandId }: { commandId: number }) => api.deleteCommand(commandId),
    onSuccess: (_, variables) => {
      const deletedCommand = allCommands.find((command) => command.id === variables.commandId);
      if (deletedCommand) {
        void queryClient.invalidateQueries({ queryKey: ["commands", deletedCommand.project_id] });
      }
      setEditingCommand((current) => (current?.id === variables.commandId ? null : current));
      showSuccess("Command deleted");
    },
    onError: showError,
  });

  const exportProjectMutation = useMutation({
    mutationFn: ({ projectId }: { projectId: number }) => api.exportProject(projectId),
    onSuccess: (_, variables) => {
      setExportDialogOpen(false);
      setExportProjectId(null);
      const project = projects.find((item) => item.id === variables.projectId);
      showSuccess("Project exported", project?.name);
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
    sortedProjectNotesById,
    newProjectNotesById,
    setNewProjectNote,
    noteVisibility,
    handleAddProjectNote,
    handleSaveEditedProjectNote,
    handleDeleteProjectNote,
    handleTogglePinnedProjectNote,
    handleToggleProjectNoteVisibility,
  } = useProjectNotes({
    projects,
    onPersist: (projectId, input, successTitle) => {
      projectNotesMutation.mutate({ id: projectId, input, successTitle });
    },
  });

  const { commandSectionsByProjectId } = useCommandSections({
    projects,
    selectedProjectId: selectedProject?.id ?? null,
    commandsByProjectId,
    queryClient,
    onError: showError,
  });

  const {
    runs,
    terminalContentByCommandId,
    adHocInteractiveCommands,
    openLogCommandIds,
    activeLogCommandId,
    setActiveLogCommandId,
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
    openAdHocInteractiveTerminal,
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

  const allCommandsWithAdHocTerminals = useMemo(
    () => [...allCommands, ...adHocInteractiveCommands],
    [adHocInteractiveCommands, allCommands],
  );

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

  async function handleManualUpdateCheck() {
    const result = await appUpdater.checkManually();
    if (result === "up-to-date") {
      setConfirmDialog({
        isOpen: true,
        title: "Kiểm tra cập nhật",
        description: "Không có bản cập nhật mới.",
        confirmLabel: "OK",
        cancelLabel: "Đóng",
        isDestructive: false,
        onConfirm: () => {},
      });
    } else if (result === "error") {
      setConfirmDialog({
        isOpen: true,
        title: "Không thể kiểm tra cập nhật",
        description: "Không thể kiểm tra, vui lòng thử lại sau.",
        confirmLabel: "OK",
        cancelLabel: "Đóng",
        isDestructive: false,
        onConfirm: () => {},
      });
    }
  }
  function openProjectDialog(project?: Project) {
    setEditingProject(project ?? null);
    setProjectDialogOpen(true);
  }

  function openCommandDialog(
    command?: ProjectCommand,
    defaultSectionName?: string,
    projectId?: number,
    preset?: {
      interactive_terminal_kind?: InteractiveTerminalKind | null;
      runtime_mode?: CommandInput["runtime_mode"] | null;
    } | null,
  ) {
    const resolvedProjectId = projectId ?? command?.project_id ?? selectedProject?.id ?? null;
    if (resolvedProjectId !== null) {
      setSelectedProjectId(resolvedProjectId);
      setCommandDialogProjectId(resolvedProjectId);
    }
    setEditingCommand(command ?? null);
    setDefaultSection(defaultSectionName ?? null);
    setCommandDialogPreset(command ? null : (preset ?? null));
    setCommandDialogOpen(true);
  }

  const handleCloseTab = (commandId: number) => {
    const command = allCommandsWithAdHocTerminals.find((c) => c.id === commandId);
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
    dateFormat,
    setDateFormat,
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
    commandCount: allCommands.length,
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
    isCheckingUpdates: appUpdater.status === "checking",
    onCheckUpdates: () => {
      void handleManualUpdateCheck();
    },
  };

  const titlebarSearchCollections = useMemo(
    () =>
      buildTitlebarSearchCollections({
        projects,
        commandsByProjectId,
        notesByProjectId: sortedProjectNotesById,
        noteVisibility,
      }),
    [commandsByProjectId, noteVisibility, projects, sortedProjectNotesById],
  );

  function handleTitlebarSearchSelect(item: TitlebarSearchItem) {
    if (item.kind === "project") {
      shellRef.current?.openProject(item.projectId);
      return;
    }

    if (item.kind === "command") {
      shellRef.current?.openCommand(item.projectId, item.commandId);
      return;
    }

      shellRef.current?.openNote(item.projectId, item.noteId);
  }

  const interactiveTerminalOptions =
    interactiveTerminalOptionsQuery.data?.length
      ? interactiveTerminalOptionsQuery.data
      : FALLBACK_WINDOWS_INTERACTIVE_TERMINAL_OPTIONS;

  function handleRequestCloseAllTerminalTabs(commandIds: number[]) {
    const closeCount = commandIds.length;
    if (closeCount === 0) {
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: "Close All Terminal Tabs",
      description:
        closeCount === 1
          ? "Are you sure you want to close the only open terminal tab?"
          : `Are you sure you want to close all ${closeCount} open terminal tabs?`,
      confirmLabel: "Close All",
      cancelLabel: "Cancel",
      isDestructive: true,
      onConfirm: () => {
        commandIds.forEach((commandId) => closeLogTabNow(commandId));
      },
    });
  }

  return (
    <MotionLevelProvider level={motionLevel}>
      <main className="app-shell flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-shell text-foreground">
        <AppTitleBar
          selectedProjectName={selectedProject?.name ?? null}
          searchCollections={titlebarSearchCollections}
          onSearchSelect={handleTitlebarSearchSelect}
        />

        <div className="min-h-0 flex flex-1 overflow-hidden">
          <VSCodeShell
            ref={shellRef}
            projects={projects}
            selectedProject={selectedProject}
            selectedProjectId={selectedProject?.id ?? null}
            commands={allCommandsWithAdHocTerminals}
            commandsByProjectId={commandsByProjectId}
            commandSectionsByProjectId={commandSectionsByProjectId}
            settingsProps={settingsProps}
            updateStatus={appUpdater.status}
            updateVersion={appUpdater.update?.version ?? null}
            onOpenUpdate={() => appUpdater.setDialogOpen(true)}
            sortedProjectNotesByProjectId={sortedProjectNotesById}
            noteVisibility={noteVisibility}
            newProjectNotesByProjectId={newProjectNotesById}
            onNewProjectNoteChange={setNewProjectNote}
            onAddProjectNote={handleAddProjectNote}
            onEditProjectNote={handleSaveEditedProjectNote}
            onTogglePinnedProjectNote={handleTogglePinnedProjectNote}
            onToggleProjectNoteVisibility={handleToggleProjectNoteVisibility}
            onDeleteProjectNote={(projectId, noteId) => {
              setConfirmDialog({
                isOpen: true,
                title: "Delete note",
                description: "Are you sure you want to delete this note?",
                confirmLabel: "Delete note",
                cancelLabel: "Cancel",
                isDestructive: true,
                onConfirm: () => handleDeleteProjectNote(projectId, noteId),
              });
            }}
            isSavingNotes={projectNotesMutation.isPending}
            runs={runs}
            terminalContentByCommandId={terminalContentByCommandId}
            openLogCommandIds={openLogCommandIds}
            activeLogCommandId={activeLogCommandId}
            onActiveLogCommandChange={setActiveLogCommandId}
            onClearLogs={clearCommandLogs}
            onCloseLogTab={handleCloseTab}
            onTerminalInput={handleTerminalInput}
            onTerminalResize={handleTerminalResize}
            terminalFontFamily={resolveTerminalFontFamilyValue(terminalFontFamily)}
            terminalFontSize={terminalFontSize}
            theme={resolvedTheme}
            onAddProject={() => openProjectDialog()}
            onImportProject={pickImportProjectFile}
            onSelectProject={setSelectedProjectId}
            onOpenExplorer={(project) => {
              void api.showProjectInExplorer(project.path).catch(showError);
            }}
            onOpenTerminal={(project) => {
              void api.openInExternalTerminal(project.path).catch(showError);
            }}
            onShareProject={(project) => {
              setSelectedProjectId(project.id);
              setExportProjectId(project.id);
              setExportDialogOpen(true);
            }}
            onEditProject={(project) => {
              setSelectedProjectId(project.id);
              openProjectDialog(project);
            }}
            onAddCommand={(projectId, preset) => {
              openCommandDialog(undefined, undefined, projectId, preset ?? null);
            }}
            onEditCommand={openCommandDialog}
            interactiveTerminalOptions={interactiveTerminalOptions}
            onRequestCloseAllLogTabs={handleRequestCloseAllTerminalTabs}
            onOpenAdHocInteractiveTerminal={(project, terminalKind) => {
              void openAdHocInteractiveTerminal(project, terminalKind);
            }}
            onDeleteCommand={(command) => {
              setConfirmDialog({
                isOpen: true,
                title: "Delete Command",
                description: `Are you sure you want to delete the command "${command.name}"?`,
                confirmLabel: "Delete Command",
                cancelLabel: "Cancel",
                isDestructive: true,
                onConfirm: () => {
                  deleteCommandMutation.mutate({ commandId: command.id });
                },
              });
            }}
            onRunCommand={(command) => {
              void startCommandRun(command);
            }}
            onStopCommand={(command) => {
              stopCommandByCommandId(command.id);
            }}
            onForceStopCommand={(command) => {
              setConfirmDialog({
                isOpen: true,
                title: "Force stop command",
                description: `Force stop \"${command.name}\" now? This sends an immediate stop request and keeps the command state in sync so you can start it again safely.`,
                confirmLabel: "Force stop",
                cancelLabel: "Cancel",
                isDestructive: true,
                onConfirm: () => forceStopCommandByCommandId(command.id),
              });
            }}
            onRestartCommand={(command) => {
              void handleRestartCommand(command);
            }}
            onKillPorts={handleKillPortsClick}
            onOpenLogs={openLogCommandTab}
          />
        </div>

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
          commandDialogProject={commandDialogProject}
          exportProject={exportProject}
          editingCommand={editingCommand}
          defaultSection={defaultSection}
          availableSections={
            commandDialogProject ? (commandSectionsByProjectId[commandDialogProject.id] ?? []).map((section) => section.section) : []
          }
          commandDialogPreset={commandDialogPreset}
          commandDialogOpen={commandDialogOpen}
          interactiveTerminalOptions={interactiveTerminalOptions}
          onCommandDialogOpenChange={(open) => {
            setCommandDialogOpen(open);
            if (!open) {
              setCommandDialogProjectId(null);
              setEditingCommand(null);
              setDefaultSection(null);
              setCommandDialogPreset(null);
            }
          }}
          commandDialogPending={commandMutation.isPending}
          onCommandError={showError}
          onCommandSubmit={(input) => commandMutation.mutate({ id: editingCommand?.id, input })}
          exportDialogOpen={exportDialogOpen}
          onExportDialogOpenChange={(open) => {
            setExportDialogOpen(open);
            if (!open) {
              setExportProjectId(null);
            }
          }}
          exportDialogPending={exportProjectMutation.isPending}
          onExportSave={() => {
            if (exportProject) {
              exportProjectMutation.mutate({ projectId: exportProject.id });
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

        <UpdateDialog
          open={appUpdater.dialogOpen}
          update={appUpdater.update}
          status={appUpdater.status}
          progress={appUpdater.progress}
          error={appUpdater.error}
          onOpenChange={appUpdater.setDialogOpen}
          onDismiss={appUpdater.dismiss}
          onDownload={() => void appUpdater.download()}
          onInstallOrReveal={() => void appUpdater.installOrReveal()}
        />

        <AnimatedToastStack toasts={toasts} onDismiss={dismissToast} position="top-right" placement="fixed" />
        <AppContextMenu menuState={contextMenu} onClose={() => setContextMenu(null)} />
      </main>
    </MotionLevelProvider>
  );
}

export default App;






