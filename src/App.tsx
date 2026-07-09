import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import TerminalUi, { ColorMode, TerminalOutput } from "react-terminal-ui";
import {
  Apple,
  Boxes,
  Braces,
  Check,
  Code2,
  Cpu,
  Database,
  Download,
  Eye,
  EyeOff,
  FileInput,
  FolderOpen,
  Globe,
  ImagePlus,
  Laptop,
  Loader2,
  LucideIcon,
  Monitor,
  Package,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  Rocket,
  RotateCcw,
  Save,
  Server,
  Settings,
  Share2,
  Smartphone,
  Square,
  Terminal,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import appIcon from "./assets/app-icon.png";
import { Avatar, AvatarFallback, AvatarImage } from "./components/ui/avatar";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader } from "./components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Textarea } from "./components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import {
  api,
  ApplyPrdImportRequest,
  CommandImportDiff,
  CommandInput,
  NoteImportDiff,
  PrdImportAnalysis,
  PortProcess,
  Project,
  ProjectCommand,
  ProjectInput,
  ProjectFieldChange,
  RunFinishedPayload,
  RunOutputPayload,
  RunStartedPayload,
} from "./lib/api";
import { AccentColor, ACCENT_THEMES } from "./lib/theme";
import { SettingsPage } from "./components/SettingsPage";

type RunState = {
  runId: number;
  commandId: number;
  status: "running" | "exited" | "failed" | "stopped";
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
};

type LogLine = {
  id: string;
  runId: number;
  commandId: number;
  stream: "stdout" | "stderr";
  line: string;
  timestamp: string;
};

type ConfirmDialogState = {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  isDestructive?: boolean;
};

type ProjectNote = {
  id: string;
  content: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

type ImportLaunchSource = "manual" | "file_open";

type ImportWizardState = {
  source: ImportLaunchSource;
  analysis: PrdImportAnalysis;
  step: "commands" | "notes";
  selectedProjectFields: string[];
  selectedCommandIndexes: number[];
  selectedNoteIndexes: number[];
};

type OverwritePreviewState = {
  request: ApplyPrdImportRequest;
  analysis: PrdImportAnalysis;
  projectFields: ProjectFieldChange[];
  commands: CommandImportDiff[];
  notes: NoteImportDiff[];
} | null;

type PrdOpenRequestPayload = {
  file_path: string;
};

const ANSI_ESCAPE_PATTERN =
  /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

function cleanTerminalLine(line: string) {
  return line.replace(ANSI_ESCAPE_PATTERN, "");
}

function parseProjectNotes(value: string | null | undefined): ProjectNote[] {
  if (!value?.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item, index) => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const content = typeof item.content === "string" ? item.content : "";
        if (!content.trim()) {
          return null;
        }

        const fallbackTime = new Date().toISOString();
        return {
          id: typeof item.id === "string" && item.id ? item.id : `note-${index}-${fallbackTime}`,
          content,
          pinned: Boolean(item.pinned),
          createdAt: typeof item.createdAt === "string" && item.createdAt ? item.createdAt : fallbackTime,
          updatedAt: typeof item.updatedAt === "string" && item.updatedAt ? item.updatedAt : fallbackTime,
        } satisfies ProjectNote;
      })
      .filter((item): item is ProjectNote => Boolean(item));
  } catch {
    const content = value.trim();
    if (!content) {
      return [];
    }

    const fallbackTime = new Date().toISOString();
    return [
      {
        id: `legacy-note-${fallbackTime}`,
        content,
        pinned: false,
        createdAt: fallbackTime,
        updatedAt: fallbackTime,
      },
    ];
  }
}

function serializeProjectNotes(notes: ProjectNote[]) {
  const cleanNotes = notes
    .map((note) => ({
      ...note,
      content: note.content.trim(),
    }))
    .filter((note) => note.content);

  return cleanNotes.length > 0 ? JSON.stringify(cleanNotes) : null;
}

function sortProjectNotes(notes: ProjectNote[]) {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }

    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function createImportWizardState(
  source: ImportLaunchSource,
  analysis: PrdImportAnalysis,
): ImportWizardState {
  return {
    source,
    analysis,
    step: "commands",
    selectedProjectFields: analysis.project_field_changes.map((change) => change.field),
    selectedCommandIndexes: analysis.command_diffs
      .filter((diff) => diff.default_selected)
      .map((diff) => diff.index),
    selectedNoteIndexes: analysis.note_diffs
      .filter((diff) => diff.default_selected)
      .map((diff) => diff.index),
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

const projectSchema = z.object({
  name: z.string().min(1, "Name is required"),
  path: z.string().min(1, "Project folder is required"),
  description: z.string().optional(),
  avatar_path: z.string().nullable().optional(),
});
const commandSchema = z.object({
  name: z.string().min(1, "Name is required"),
  script: z.string().min(1, "Script is required"),
  avatar_path: z.string().nullable().optional(),
  ports: z.string().optional(),
  section: z.string().optional(),
  run_in_external_terminal: z.boolean().optional(),
});
type ProjectFormValues = z.infer<typeof projectSchema>;
type CommandFormValues = z.infer<typeof commandSchema>;

const LUCIDE_ICON_PREFIX = "lucide:";

const iconOptions: Array<{ id: string; label: string; Icon: LucideIcon }> = [
  { id: "terminal", label: "Terminal", Icon: Terminal },
  { id: "folder", label: "Folder", Icon: FolderOpen },
  { id: "code", label: "Code", Icon: Code2 },
  { id: "braces", label: "Braces", Icon: Braces },
  { id: "database", label: "Database", Icon: Database },
  { id: "server", label: "Server", Icon: Server },
  { id: "globe", label: "Globe", Icon: Globe },
  { id: "package", label: "Package", Icon: Package },
  { id: "boxes", label: "Boxes", Icon: Boxes },
  { id: "cpu", label: "CPU", Icon: Cpu },
  { id: "wrench", label: "Wrench", Icon: Wrench },
  { id: "settings", label: "Settings", Icon: Settings },
  { id: "rocket", label: "Rocket", Icon: Rocket },
  { id: "ios", label: "iOS", Icon: Smartphone },
  { id: "windows", label: "Windows", Icon: Monitor },
  { id: "linux", label: "Linux", Icon: Terminal },
  { id: "android", label: "Android", Icon: Smartphone },
  { id: "macos", label: "macOS", Icon: Apple },
  { id: "desktop", label: "Desktop", Icon: Laptop },
];

const DEFAULT_SECTION = "General";

function parsePorts(value: string | null | undefined) {
  return (value ?? "")
    .split(/[\s,;]+/)
    .map((part) => Number(part.trim()))
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
}

function commandPorts(command: ProjectCommand) {
  try {
    const value = JSON.parse(command.ports || "[]");
    return Array.isArray(value) ? value.filter((port) => Number.isInteger(port)) : [];
  } catch {
    return [];
  }
}

function portsToInput(value: string | null | undefined) {
  return commandPorts({ ports: value ?? "[]" } as ProjectCommand).join(", ");
}

function lucideIconValue(id: string) {
  return `${LUCIDE_ICON_PREFIX}${id}`;
}

function lucideIconId(value: string | null | undefined) {
  return value?.startsWith(LUCIDE_ICON_PREFIX) ? value.slice(LUCIDE_ICON_PREFIX.length) : null;
}

function lucideIconOption(value: string | null | undefined) {
  const id = lucideIconId(value);
  return iconOptions.find((option) => option.id === id);
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function avatarSrc(path: string | null | undefined) {
  if (!path || lucideIconId(path)) {
    return undefined;
  }
  return convertFileSrc(path);
}

function App() {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [commandDialogOpen, setCommandDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("theme");
    return (saved === "dark" || saved === "light") ? saved : "light";
  });

  const [accent, setAccent] = useState<AccentColor>(() => {
    const saved = localStorage.getItem("accent") as AccentColor;
    return (saved === "indigo" || saved === "emerald" || saved === "rose" || saved === "amber" || saved === "sky") ? saved : "indigo";
  });

  const [terminalFontSize, setTerminalFontSize] = useState(() => {
    return localStorage.getItem("terminalFontSize") || "14px";
  });

  const [terminalFontFamily, setTerminalFontFamily] = useState(() => {
    return localStorage.getItem("terminalFontFamily") || "JetBrains Mono";
  });

  const [autoClearLogs, setAutoClearLogs] = useState(() => {
    const saved = localStorage.getItem("autoClearLogs");
    return saved === null ? true : saved === "true";
  });

  const [showLogsTimestamp, setShowLogsTimestamp] = useState(() => {
    const saved = localStorage.getItem("showLogsTimestamp");
    return saved === "true";
  });

  const [showStreamName, setShowStreamName] = useState(() => {
    const saved = localStorage.getItem("showStreamName");
    return saved === null ? true : saved === "true";
  });

  useEffect(() => {
    localStorage.setItem("theme", theme);
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("theme-light");
      root.classList.remove("theme-dark");
    } else {
      root.classList.add("theme-dark");
      root.classList.remove("theme-light");
    }
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("accent", accent);
    const root = document.documentElement;
    const colors = ACCENT_THEMES[accent] || ACCENT_THEMES.indigo;
    root.style.setProperty("--primary-color", colors.primary);
    root.style.setProperty("--primary-gradient", colors.gradient);
    root.style.setProperty("--primary-glow", colors.glow);
  }, [accent]);

  useEffect(() => {
    localStorage.setItem("terminalFontSize", terminalFontSize);
    const root = document.documentElement;
    root.style.setProperty("--terminal-font-size", terminalFontSize);
  }, [terminalFontSize]);

  useEffect(() => {
    localStorage.setItem("terminalFontFamily", terminalFontFamily);
    const root = document.documentElement;
    const fontValue =
      terminalFontFamily === "JetBrains Mono"
        ? "'JetBrains Mono', monospace"
        : terminalFontFamily === "Fira Code"
          ? "'Fira Code', monospace"
          : terminalFontFamily === "SF Mono"
            ? "'SF Mono', system-ui, monospace"
            : "'Courier New', monospace";
    root.style.setProperty("--terminal-font-family", fontValue);
  }, [terminalFontFamily]);

  useEffect(() => {
    localStorage.setItem("autoClearLogs", String(autoClearLogs));
  }, [autoClearLogs]);

  useEffect(() => {
    localStorage.setItem("showLogsTimestamp", String(showLogsTimestamp));
  }, [showLogsTimestamp]);

  useEffect(() => {
    localStorage.setItem("showStreamName", String(showStreamName));
  }, [showStreamName]);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [newProjectImportAnalysis, setNewProjectImportAnalysis] = useState<{
    source: ImportLaunchSource;
    analysis: PrdImportAnalysis;
  } | null>(null);
  const [importWizard, setImportWizard] = useState<ImportWizardState | null>(null);
  const [overwritePreview, setOverwritePreview] = useState<OverwritePreviewState>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editingCommand, setEditingCommand] = useState<ProjectCommand | null>(null);
  const [runs, setRuns] = useState<Record<number, RunState>>({});
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [openLogCommandIds, setOpenLogCommandIds] = useState<number[]>([]);
  const [activeLogCommandId, setActiveLogCommandId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stoppingRunIds, setStoppingRunIds] = useState<Set<number>>(new Set());
  const [scanningCommandId, setScanningCommandId] = useState<number | null>(null);
  const [killPortsCommand, setKillPortsCommand] = useState<ProjectCommand | null>(null);
  const [portProcesses, setPortProcesses] = useState<PortProcess[]>([]);
  const [killPortsDialogOpen, setKillPortsDialogOpen] = useState(false);
  const [killingPorts, setKillingPorts] = useState(false);
  const [projectTab, setProjectTab] = useState<"commands" | "notes">("commands");
  const [projectNotes, setProjectNotes] = useState<ProjectNote[]>([]);
  const [newProjectNote, setNewProjectNote] = useState("");
  const [noteVisibility, setNoteVisibility] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem("project_note_visibility");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [restartPendingCommandIds, setRestartPendingCommandIds] = useState<number[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    isOpen: false,
    title: "",
    description: "",
    onConfirm: () => {},
  });

  const [emptySections, setEmptySections] = useState<Record<number, string[]>>(() => {
    try {
      const saved = localStorage.getItem("empty_sections");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem("empty_sections", JSON.stringify(emptySections));
  }, [emptySections]);
  useEffect(() => {
    localStorage.setItem("project_note_visibility", JSON.stringify(noteVisibility));
  }, [noteVisibility]);
  const [isAddingSection, setIsAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [defaultSection, setDefaultSection] = useState<string | null>(null);
  const [renamingSection, setRenamingSection] = useState<string | null>(null);
  const [renameSectionValue, setRenameSectionValue] = useState("");
  const addSectionInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (isAddingSection) {
      addSectionInputRef.current?.focus();
    }
  }, [isAddingSection]);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });

  const projects = projectsQuery.data ?? [];
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;
  const sortedProjectNotes = useMemo(() => sortProjectNotes(projectNotes), [projectNotes]);

  useEffect(() => {
    setProjectNotes(parseProjectNotes(selectedProject?.notes));
    setNewProjectNote("");
  }, [selectedProject?.id, selectedProject?.notes]);

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

  const commandSections = useMemo(() => {
    const sections = new Map<string, ProjectCommand[]>();
    for (const command of commands) {
      const section = command.section?.trim() || DEFAULT_SECTION;
      sections.set(section, [...(sections.get(section) ?? []), command]);
    }
    
    // Add any empty sections for this project
    if (selectedProject) {
      const projectEmptySections = emptySections[selectedProject.id] !== undefined
        ? emptySections[selectedProject.id]
        : [DEFAULT_SECTION];
      for (const section of projectEmptySections) {
        if (!sections.has(section)) {
          sections.set(section, []);
        }
      }
    }

    return Array.from(sections.entries()).map(([section, items]) => ({ section, commands: items }));
  }, [commands, selectedProject, emptySections]);

  useEffect(() => {
    const unlisteners = [
      listen<RunStartedPayload>("command://started", (event) => {
        setRuns((current) => ({
          ...current,
          [event.payload.command_id]: {
            runId: event.payload.run_id,
            commandId: event.payload.command_id,
            status: "running",
            startedAt: event.payload.started_at,
          },
        }));
        setOpenLogCommandIds((current) =>
          current.includes(event.payload.command_id) ? current : [...current, event.payload.command_id],
        );
        setActiveLogCommandId(event.payload.command_id);
      }),
      listen<RunOutputPayload>("command://stdout", (event) => {
        setLogs((current) => [
          ...current,
          {
            id: `${event.payload.run_id}-out-${current.length}`,
            runId: event.payload.run_id,
            commandId: event.payload.command_id,
            stream: "stdout",
            line: cleanTerminalLine(event.payload.line),
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
      }),
      listen<RunOutputPayload>("command://stderr", (event) => {
        setLogs((current) => [
          ...current,
          {
            id: `${event.payload.run_id}-err-${current.length}`,
            runId: event.payload.run_id,
            commandId: event.payload.command_id,
            stream: "stderr",
            line: cleanTerminalLine(event.payload.line),
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
      }),
      listen<RunFinishedPayload>("command://finished", (event) => {
        setRuns((current) => ({
          ...current,
          [event.payload.command_id]: {
            runId: event.payload.run_id,
            commandId: event.payload.command_id,
            status:
              event.payload.status === "exited"
                ? "exited"
                : event.payload.status === "stopped"
                  ? "stopped"
                  : "failed",
            startedAt: current[event.payload.command_id]?.startedAt ?? event.payload.ended_at,
            endedAt: event.payload.ended_at,
            exitCode: event.payload.exit_code,
          },
        }));

        setRestartPendingCommandIds((current) => {
          if (!current.includes(event.payload.command_id)) {
            return current;
          }

          if (autoClearLogs) {
            setLogs((lines) => lines.filter((line) => line.commandId !== event.payload.command_id));
          }
          void api.runCommand(event.payload.command_id).catch(showError);
          return current.filter((id) => id !== event.payload.command_id);
        });
      }),
    ];

    return () => {
      void Promise.all(unlisteners).then((items) => items.forEach((unlisten) => unlisten()));
    };
  }, [autoClearLogs]);

  useEffect(() => {
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
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      setSelectedProjectId(project.id);
      setProjectDialogOpen(false);
      setEditingProject(null);
    },
    onError: showError,
  });

  const projectNotesMutation = useMutation({
    mutationFn: ({ id, input }: { id: number; input: ProjectInput }) => api.updateProject(id, input),
    onSuccess: (project) => {
      setProjectNotes(parseProjectNotes(project.notes));
      setNewProjectNote("");
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: showError,
  });

  const deleteProjectMutation = useMutation({
    mutationFn: api.deleteProject,
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      setSelectedProjectId((current) => (current === id ? null : current));
    },
    onError: showError,
  });

  const commandMutation = useMutation({
    mutationFn: ({ id, input }: { id?: number; input: CommandInput }) =>
      id ? api.updateCommand(id, input) : api.createCommand(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["commands", selectedProject?.id] });
      setCommandDialogOpen(false);
      setEditingCommand(null);
    },
    onError: showError,
  });

  const deleteCommandMutation = useMutation({
    mutationFn: api.deleteCommand,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["commands", selectedProject?.id] });
    },
    onError: showError,
  });

  const runMutation = useMutation({
    mutationFn: api.runCommand,
    onError: showError,
  });

  const stopMutation = useMutation({
    mutationFn: api.stopCommand,
    onMutate: (runId) => {
      setStoppingRunIds((prev) => {
        const next = new Set(prev);
        next.add(runId);
        return next;
      });
    },
    onSettled: (_, __, runId) => {
      setStoppingRunIds((prev) => {
        const next = new Set(prev);
        next.delete(runId);
        return next;
      });
    },
    onSuccess: (_, runId) => {
      setRuns((current) => {
        const entry = Object.values(current).find((run) => run.runId === runId);
        if (!entry) {
          return current;
        }
        return {
          ...current,
          [entry.commandId]: {
            ...entry,
            status: "stopped",
            endedAt: new Date().toISOString(),
          },
        };
      });
    },
    onError: showError,
  });



  const exportProjectMutation = useMutation({
    mutationFn: api.exportProject,
    onSuccess: () => setExportDialogOpen(false),
    onError: showError,
  });

  const importProjectMutation = useMutation({
    mutationFn: api.applyPrdImport,
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["commands"] });
      setSelectedProjectId(project.id);
      setNewProjectImportAnalysis(null);
      setImportWizard(null);
      setOverwritePreview(null);
    },
    onError: showError,
  });

  function showError(error: unknown) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
  }

  function startCommandRun(commandId: number) {
    if (autoClearLogs) {
      setLogs((current) => current.filter((line) => line.commandId !== commandId));
    }
    openLogCommandTab(commandId);
    runMutation.mutate(commandId);
  }

  async function handleRestartCommand(command: ProjectCommand) {
    openLogCommandTab(command.id);

    const run = runs[command.id];
    if (run?.status === "running") {
      setRestartPendingCommandIds((current) =>
        current.includes(command.id) ? current : [...current, command.id],
      );
      try {
        await stopMutation.mutateAsync(run.runId);
      } catch (error) {
        setRestartPendingCommandIds((current) => current.filter((id) => id !== command.id));
        showError(error);
      }
      return;
    }

    startCommandRun(command.id);
  }

  function persistProjectNotes(nextNotes: ProjectNote[]) {
    if (!selectedProject) {
      return;
    }

    projectNotesMutation.mutate({
      id: selectedProject.id,
      input: {
        name: selectedProject.name,
        path: selectedProject.path,
        avatar_path: selectedProject.avatar_path,
        description: selectedProject.description,
        notes: serializeProjectNotes(nextNotes),
      },
    });
  }

  function handleAddProjectNote() {
    const content = newProjectNote.trim();
    if (!content) {
      return;
    }

    const timestamp = new Date().toISOString();
    const nextNotes = [
      {
        id: `note-${crypto.randomUUID()}`,
        content,
        pinned: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      ...projectNotes,
    ];

    setProjectNotes(nextNotes);
    setNewProjectNote("");
    persistProjectNotes(nextNotes);
  }

  function handleUpdateProjectNote(noteId: string, content: string) {
    setProjectNotes((current) =>
      current.map((note) =>
        note.id === noteId
          ? {
              ...note,
              content,
            }
          : note,
      ),
    );
  }

  function handleSaveEditedProjectNote(noteId: string) {
    const nextNotes = projectNotes
      .map((note) =>
        note.id === noteId
          ? {
              ...note,
              content: note.content.trim(),
              updatedAt: new Date().toISOString(),
            }
          : note,
      )
      .filter((note) => note.content);

    setProjectNotes(nextNotes);
    persistProjectNotes(nextNotes);
  }

  function handleDeleteProjectNote(noteId: string) {
    const nextNotes = projectNotes.filter((note) => note.id !== noteId);
    setProjectNotes(nextNotes);
    setNoteVisibility((current) => {
      const next = { ...current };
      delete next[noteId];
      return next;
    });
    persistProjectNotes(nextNotes);
  }

  function handleTogglePinnedProjectNote(noteId: string) {
    const nextNotes = projectNotes.map((note) =>
      note.id === noteId
        ? {
            ...note,
            pinned: !note.pinned,
            updatedAt: new Date().toISOString(),
          }
        : note,
    );

    setProjectNotes(nextNotes);
    persistProjectNotes(nextNotes);
  }

  function handleToggleProjectNoteVisibility(noteId: string) {
    setNoteVisibility((current) => ({
      ...current,
      [noteId]: current[noteId] === undefined ? false : !current[noteId],
    }));
  }

  const handleKillPortsClick = async (command: ProjectCommand) => {
    const ports = commandPorts(command);
    if (ports.length === 0) return;

    setScanningCommandId(command.id);
    try {
      const processes = await api.getPortsProcesses(ports);
      setPortProcesses(processes);
      setKillPortsCommand(command);
      setKillPortsDialogOpen(true);
    } catch (error) {
      showError(error);
    } finally {
      setScanningCommandId(null);
    }
  };

  const handleKillProcesses = async (pids: number[]) => {
    setKillingPorts(true);
    try {
      await api.killProcesses(pids);
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (killPortsCommand) {
        const ports = commandPorts(killPortsCommand);
        const processes = await api.getPortsProcesses(ports);
        setPortProcesses(processes);
      }
    } catch (error) {
      showError(error);
    } finally {
      setKillingPorts(false);
    }
  };

  const handleRefreshProcesses = async () => {
    if (!killPortsCommand) return;
    const ports = commandPorts(killPortsCommand);
    try {
      const processes = await api.getPortsProcesses(ports);
      setPortProcesses(processes);
    } catch (error) {
      showError(error);
    }
  };

  function openProjectDialog(project?: Project) {
    setEditingProject(project ?? null);
    setProjectDialogOpen(true);
  }

  function openCommandDialog(command?: ProjectCommand, defaultSectionName?: string) {
    setEditingCommand(command ?? null);
    setDefaultSection(defaultSectionName ?? null);
    setCommandDialogOpen(true);
  }

  function handleAddSectionSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = newSectionName.trim();
    if (!name) return;

    if (!selectedProject) return;

    const exists = commandSections.some(
      (s) => s.section.toLowerCase() === name.toLowerCase()
    );
    if (exists) {
      showError(new Error(`Section "${name}" already exists.`));
      return;
    }

    setEmptySections((current) => {
      const projectSections = current[selectedProject.id] !== undefined
        ? current[selectedProject.id]
        : [DEFAULT_SECTION];

      if (projectSections.includes(name)) return current;
      return {
        ...current,
        [selectedProject.id]: [...projectSections, name],
      };
    });

    setIsAddingSection(false);
    setNewSectionName("");
  }

  const handleRenameSection = async (oldName: string, newName: string) => {
    const cleanNewName = newName.trim();
    if (!cleanNewName || cleanNewName === oldName) {
      setRenamingSection(null);
      return;
    }

    if (!selectedProject) return;

    const exists = commandSections.some(
      (s) => s.section.toLowerCase() === cleanNewName.toLowerCase() && s.section !== oldName
    );
    if (exists) {
      showError(new Error(`Section "${cleanNewName}" already exists.`));
      return;
    }

    try {
      const oldSectionCommands = commandSections.find((s) => s.section === oldName)?.commands ?? [];
      for (const cmd of oldSectionCommands) {
        await api.updateCommand(cmd.id, {
          project_id: cmd.project_id,
          name: cmd.name,
          script: cmd.script,
          avatar_path: cmd.avatar_path,
          ports: commandPorts(cmd),
          section: cleanNewName,
          order_index: cmd.order_index,
          run_in_external_terminal: cmd.run_in_external_terminal,
        });
      }

      setEmptySections((current) => {
        const projectSections = current[selectedProject.id];
        if (!projectSections) return current;
        return {
          ...current,
          [selectedProject.id]: projectSections.map((s) => (s === oldName ? cleanNewName : s)),
        };
      });

      void queryClient.invalidateQueries({ queryKey: ["commands", selectedProject.id] });
    } catch (error) {
      showError(error);
    } finally {
      setRenamingSection(null);
    }
  };

  function openLogCommandTab(commandId: number) {
    setOpenLogCommandIds((current) => (current.includes(commandId) ? current : [...current, commandId]));
    setActiveLogCommandId(commandId);
  }

  const handleCloseTab = (commandId: number) => {
    const command = commands.find((c) => c.id === commandId);
    const cmdName = command ? ` "${command.name}"` : "";
    const run = runs[commandId];
    const isRunning = run && run.status === "running";

    setConfirmDialog({
      isOpen: true,
      title: "Close Terminal Tab",
      description: isRunning
        ? `Are you sure you want to close the terminal tab${cmdName}? This will stop the running process.`
        : `Are you sure you want to close the terminal tab${cmdName}?`,
      confirmLabel: "Close Tab",
      cancelLabel: "Cancel",
      isDestructive: isRunning,
      onConfirm: () => {
        // 1. Stop command if running
        if (run && run.status === "running") {
          stopMutation.mutate(run.runId);
        }
        
        // 2. Remove from openLogCommandIds
        setOpenLogCommandIds((current) => current.filter((id) => id !== commandId));
        
        // 3. Clear logs
        setLogs((current) => current.filter((line) => line.commandId !== commandId));
        
        // 4. Remove from runs
        setRuns((current) => {
          const next = { ...current };
          delete next[commandId];
          return next;
        });
        
        // 5. If it was active, switch active log tab
        if (activeLogCommandId === commandId) {
          const remaining = openLogCommandIds.filter((id) => id !== commandId);
          if (remaining.length > 0) {
            setActiveLogCommandId(remaining[remaining.length - 1]);
          } else {
            setActiveLogCommandId(null);
          }
        }
      },
    });
  };
  async function beginImportFromPath(filePath: string, source: ImportLaunchSource) {
    const analysis = await api.analyzePrdFile(filePath);
    if (!analysis.existing_project) {
      if (source === "file_open") {
        importProjectMutation.mutate(buildNewProjectImportRequest(analysis));
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
      showError(error);
    }
  }

  function toggleSelectedIndex(
    current: number[],
    index: number,
  ) {
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

  function handleImportWizardSubmit() {
    if (!importWizard) {
      return;
    }

    const selectedProjectFields = importWizard.analysis.project_field_changes.filter((change) =>
      importWizard.selectedProjectFields.includes(change.field) && change.status === "overwrite",
    );
    const selectedCommands = importWizard.analysis.command_diffs.filter((diff) =>
      importWizard.selectedCommandIndexes.includes(diff.index) && diff.status === "overwrite",
    );
    const selectedNotes = importWizard.analysis.note_diffs.filter((diff) =>
      importWizard.selectedNoteIndexes.includes(diff.index) && diff.status === "overwrite",
    );

    const request = buildWizardImportRequest(importWizard, selectedProjectFields.length === 0 && selectedCommands.length === 0 && selectedNotes.length === 0);

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

    importProjectMutation.mutate(request);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand-lockup">
            <img className="app-icon" src={appIcon} alt="" />
            <div>
              <h1>Projects Runner</h1>
              <p>{projects.length} projects</p>
            </div>
          </div>
        </div>
        <div className="sidebar-actions">
          <Button onClick={() => openProjectDialog()}>
            <Plus size={15} />
            Add Project
          </Button>
          <Button variant="outline" onClick={pickImportProjectFile}>
            <FileInput size={15} />
            Import .prd
          </Button>
        </div>

        <div className="project-list">
          {projects.map((project) => (
            <button
              className={`project-row ${selectedProject?.id === project.id ? "active" : ""}`}
              key={project.id}
              onClick={() => {
                setSettingsOpen(false);
                setSelectedProjectId(project.id);
              }}
            >
              <EntityAvatar name={project.name} path={project.avatar_path} />
              <span>
                <strong>{project.name}</strong>
              </span>
            </button>
          ))}
          {projects.length === 0 && <p className="empty-text">Create your first project to start running commands.</p>}
        </div>
        <div className="sidebar-footer">
          <Button
            className="settings-button"
            variant={settingsOpen ? "secondary" : "ghost"}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={16} />
            Settings
          </Button>
        </div>
      </aside>

      <section className="workspace">
        {settingsOpen ? (
          <SettingsPage
            appInfo={appInfoQuery.data}
            theme={theme}
            setTheme={setTheme}
            accent={accent}
            setAccent={setAccent}
            terminalFontSize={terminalFontSize}
            setTerminalFontSize={setTerminalFontSize}
            terminalFontFamily={terminalFontFamily}
            setTerminalFontFamily={setTerminalFontFamily}
            autoClearLogs={autoClearLogs}
            setAutoClearLogs={setAutoClearLogs}
            showLogsTimestamp={showLogsTimestamp}
            setShowLogsTimestamp={setShowLogsTimestamp}
            showStreamName={showStreamName}
            setShowStreamName={setShowStreamName}
            projectCount={projects.length}
            commandCount={commands.length}
            onResetCache={() => {
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
            }}
          />
        ) : selectedProject ? (
          <>
            <header className="workspace-header">
              <div className="title-cluster">
                <EntityAvatar name={selectedProject.name} path={selectedProject.avatar_path} />
                <div>
                  <h2>{selectedProject.name}</h2>
                  <p>{selectedProject.path}</p>
                </div>
              </div>
              <div className="toolbar">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    void api.showProjectInExplorer(selectedProject.path).catch(showError);
                  }}
                  title="Show in Explorer"
                >
                  <FolderOpen size={16} />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    void api.openInExternalTerminal(selectedProject.path).catch(showError);
                  }}
                  title="Open in External Terminal"
                >
                  <Terminal size={16} />
                </Button>
                <Button variant="outline" onClick={() => openProjectDialog(selectedProject)}>
                  <Pencil size={16} />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setExportDialogOpen(true)}
                  title="Share Project"
                >
                  <Share2 size={16} />
                </Button>
                <Button onClick={() => openCommandDialog()}>
                  <Plus size={16} />
                  Command
                </Button>
              </div>
            </header>

            {selectedProject.description && <p className="project-description">{selectedProject.description}</p>}

            <Tabs
              className="project-detail-tabs"
              value={projectTab}
              onValueChange={(value) => setProjectTab(value as "commands" | "notes")}
            >
              <div className="project-detail-tabs-bar">
                <TabsList>
                  <TabsTrigger value="commands">Commands</TabsTrigger>
                  <TabsTrigger value="notes">Notes</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="commands" className="project-detail-tab-content">
                <div className="content-grid">
                  <section className="command-sections">
                    {commandSections.map(({ section, commands: sectionCommands }) => (
                      <div className="command-section" key={section}>
                        <div className="section-header">
                          {renamingSection === section ? (
                            <form
                              className="rename-section-form"
                              onSubmit={(e) => {
                                e.preventDefault();
                                void handleRenameSection(section, renameSectionValue);
                              }}
                            >
                              <Input
                                type="text"
                                className="rename-section-input"
                                value={renameSectionValue}
                                onChange={(e) => setRenameSectionValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") {
                                    setRenamingSection(null);
                                  }
                                }}
                                autoFocus
                              />
                              <Button
                                type="submit"
                                size="icon"
                                variant="ghost"
                                className="rename-save-btn"
                                title="Save"
                              >
                                <Check size={14} />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="rename-cancel-btn"
                                onClick={() => setRenamingSection(null)}
                                title="Cancel"
                              >
                                <X size={14} />
                              </Button>
                            </form>
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <h3>{section}</h3>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="rename-section-btn"
                                onClick={() => {
                                  setRenamingSection(section);
                                  setRenameSectionValue(section);
                                }}
                                title="Rename section"
                              >
                                <Pencil size={12} />
                              </Button>
                            </div>
                          )}
                          <Badge variant="muted">{sectionCommands.length}</Badge>
                        </div>
                        <div className="command-grid">
                          {sectionCommands.map((command) => (
                            <CommandCard
                              command={command}
                              key={command.id}
                              onDelete={() => {
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
                              }}
                              onEdit={() => openCommandDialog(command)}
                              onKillPorts={() => handleKillPortsClick(command)}
                              onRestart={() => {
                                void handleRestartCommand(command);
                              }}
                              onRun={() => startCommandRun(command.id)}
                              onStop={() => {
                                const run = runs[command.id];
                                if (run) {
                                  stopMutation.mutate(run.runId);
                                }
                              }}
                              run={runs[command.id]}
                              isStopping={Boolean(runs[command.id] && stoppingRunIds.has(runs[command.id]!.runId))}
                              isRestarting={restartPendingCommandIds.includes(command.id)}
                              isScanningPorts={scanningCommandId === command.id}
                              onOpenLogs={() => openLogCommandTab(command.id)}
                            />
                          ))}
                          {sectionCommands.length === 0 && (
                            <Card className="empty-section-card">
                              <Terminal size={24} className="empty-section-icon" />
                              <div className="empty-section-info">
                                <h4>No commands in this section</h4>
                                <p>Add a command to run in this section.</p>
                              </div>
                              <div className="empty-section-actions">
                                <Button size="sm" onClick={() => openCommandDialog(undefined, section)}>
                                  <Plus size={14} /> Add command
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setConfirmDialog({
                                      isOpen: true,
                                      title: "Delete Section",
                                      description: `Are you sure you want to delete the section "${section}"?`,
                                      confirmLabel: "Delete Section",
                                      cancelLabel: "Cancel",
                                      isDestructive: true,
                                      onConfirm: () => {
                                        setEmptySections((current) => {
                                          const projectSections = current[selectedProject?.id ?? 0] !== undefined
                                            ? current[selectedProject?.id ?? 0]
                                            : [DEFAULT_SECTION];
                                          return {
                                            ...current,
                                            [selectedProject?.id ?? 0]: projectSections.filter((s) => s !== section),
                                          };
                                        });
                                      },
                                    });
                                  }}
                                >
                                  <Trash2 size={14} /> Delete section
                                </Button>
                              </div>
                            </Card>
                          )}
                        </div>
                      </div>
                    ))}

                    {selectedProject && (
                      <div className="add-section-wrapper">
                        <hr className="section-separator" />
                        {isAddingSection ? (
                          <form className="add-section-form" onSubmit={handleAddSectionSubmit}>
                            <Input
                              ref={addSectionInputRef}
                              placeholder="New section name..."
                              value={newSectionName}
                              onChange={(e) => setNewSectionName(e.target.value)}
                              className="add-section-input"
                            />
                            <div className="add-section-actions">
                              <Button type="submit" size="sm">
                                Add
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setIsAddingSection(false);
                                  setNewSectionName("");
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          </form>
                        ) : (
                          <Button
                            variant="outline"
                            className="add-section-button"
                            onClick={() => setIsAddingSection(true)}
                          >
                            <Plus size={16} />
                            Add Section
                          </Button>
                        )}
                      </div>
                    )}

                    {commands.length === 0 && (emptySections[selectedProject?.id ?? 0] ?? [DEFAULT_SECTION]).length === 0 && (
                      <Card className="empty-card">
                        <Terminal size={28} />
                        <h3>No commands yet</h3>
                        <p>Add commands like frontend dev servers, API workers, tests, or build steps.</p>
                        <Button onClick={() => openCommandDialog()}>
                          <Plus size={16} />
                          Add command
                        </Button>
                      </Card>
                    )}
                  </section>
                  <LogPanel
                    activeCommandId={activeLogCommandId}
                    commands={commands}
                    logs={logs}
                    openCommandIds={openLogCommandIds}
                    onActiveCommandChange={setActiveLogCommandId}
                    onClear={(commandId) =>
                      setLogs((current) => current.filter((line) => line.commandId !== commandId))
                    }
                    onCloseTab={handleCloseTab}
                    runs={runs}
                    theme={theme}
                    showLogsTimestamp={showLogsTimestamp}
                    showStreamName={showStreamName}
                  />
                </div>
              </TabsContent>

              <TabsContent value="notes" className="project-detail-tab-content">
                <div className="project-notes-layout">
                  <div className="project-notes-stack">
                    <div className="project-notes-header">
                      <div>
                        <h3>Project notes</h3>
                        <p>Ghi chú ngắn theo từng mảnh, có thể ghim note quan trọng lên đầu.</p>
                      </div>
                    </div>

                    <div className="project-note-composer">
                      <Textarea
                        value={newProjectNote}
                        onChange={(event) => setNewProjectNote(event.target.value)}
                        rows={3}
                        placeholder="Thêm một note mới, ví dụ: cách start local, tài khoản test, checklist deploy..."
                      />
                      <div className="project-note-composer-actions">
                        <Button
                          onClick={handleAddProjectNote}
                          disabled={!newProjectNote.trim() || projectNotesMutation.isPending}
                        >
                          {projectNotesMutation.isPending ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
                          Thêm note
                        </Button>
                      </div>
                    </div>

                    {sortedProjectNotes.length > 0 ? (
                      <div className="project-notes-grid">
                        {sortedProjectNotes.map((note) => {
                          const isVisible = noteVisibility[note.id] ?? true;

                          return (
                            <article
                              key={note.id}
                              className={`project-note-item ${note.pinned ? "pinned" : ""}`}
                            >
                              <div className="project-note-item-header">
                                <div className="project-note-meta">
                                  <Badge variant={note.pinned ? "success" : "muted"}>
                                    {note.pinned ? "Pinned" : "Note"}
                                  </Badge>
                                  <span>
                                    {new Date(note.updatedAt).toLocaleString()}
                                  </span>
                                </div>
                                <div className="project-note-actions">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleToggleProjectNoteVisibility(note.id)}
                                  >
                                    {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                                    {isVisible ? "Ẩn" : "Hiện"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleTogglePinnedProjectNote(note.id)}
                                  >
                                    {note.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                                    {note.pinned ? "Bỏ ghim" : "Ghim"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      setConfirmDialog({
                                        isOpen: true,
                                        title: "Xóa note",
                                        description: "Bạn có chắc muốn xóa note này không?",
                                        confirmLabel: "Xóa note",
                                        cancelLabel: "Hủy",
                                        isDestructive: true,
                                        onConfirm: () => handleDeleteProjectNote(note.id),
                                      });
                                    }}
                                  >
                                    <Trash2 size={14} />
                                    Xóa
                                  </Button>
                                </div>
                              </div>
                              {isVisible ? (
                                <>
                                  <Textarea
                                    value={note.content}
                                    onChange={(event) => handleUpdateProjectNote(note.id, event.target.value)}
                                    rows={4}
                                    className="project-note-textarea"
                                  />
                                  <div className="project-note-footer">
                                    <Button
                                      size="sm"
                                      onClick={() => handleSaveEditedProjectNote(note.id)}
                                      disabled={!note.content.trim() || projectNotesMutation.isPending}
                                    >
                                      {projectNotesMutation.isPending ? <Loader2 className="spin" size={14} /> : <Save size={14} />}
                                      Lưu
                                    </Button>
                                  </div>
                                </>
                              ) : (
                                <div className="project-note-collapsed">
                                  <p>Nội dung note đang được ẩn.</p>
                                </div>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="notes-hidden-state">
                        <p>Chưa có note nào cho project này. Thêm note đầu tiên ở ô phía trên.</p>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <div className="welcome">
            <img className="welcome-icon" src={appIcon} alt="" />
            <h2>Manage repeat project commands</h2>
            <p>Add a project folder, then save multi-line commands you run often.</p>
            <div className="welcome-actions">
              <Button onClick={() => openProjectDialog()}>
                <Plus size={16} />
                Add project
              </Button>
              <Button variant="outline" onClick={pickImportProjectFile}>
                <FileInput size={16} />
                Import .prd
              </Button>
            </div>
          </div>
        )}
      </section>

      <ProjectDialog
        key={editingProject?.id ?? "new-project"}
        open={projectDialogOpen}
        project={editingProject}
        isPending={projectMutation.isPending}
        onDelete={(project) => {
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
        onError={showError}
        onOpenChange={setProjectDialogOpen}
        onSubmit={(input) =>
          projectMutation.mutate({
            id: editingProject?.id,
            input: {
              ...input,
              notes: editingProject?.notes ?? null,
            },
          })
        }
      />

      {selectedProject && (
        <CommandDialog
          key={`${editingCommand?.id ?? "new-command"}-${defaultSection ?? ""}`}
          command={editingCommand}
          defaultSection={defaultSection}
          availableSections={commandSections.map((s) => s.section)}
          isPending={commandMutation.isPending}
          open={commandDialogOpen}
          projectId={selectedProject.id}
          onError={showError}
          onOpenChange={setCommandDialogOpen}
          onSubmit={(input) => commandMutation.mutate({ id: editingCommand?.id, input })}
        />
      )}

      {selectedProject && (
        <ExportProjectDialog
          isPending={exportProjectMutation.isPending}
          open={exportDialogOpen}
          project={selectedProject}
          onOpenChange={setExportDialogOpen}
          onSave={() => exportProjectMutation.mutate(selectedProject.id)}
        />
      )}

      <ImportProjectDialog
        isPending={importProjectMutation.isPending}
        preview={newProjectImportAnalysis?.analysis ?? null}
        onImport={(analysis) => {
          importProjectMutation.mutate(buildNewProjectImportRequest(analysis));
        }}
        onOpenChange={(open) => {
          if (!open) {
            setNewProjectImportAnalysis(null);
          }
        }}
      />

      <ImportWizardDialog
        wizard={importWizard}
        isPending={importProjectMutation.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setImportWizard(null);
            setOverwritePreview(null);
          }
        }}
        onBack={() => {
          setImportWizard((current) => (current ? { ...current, step: "commands" } : current));
        }}
        onNext={() => {
          setImportWizard((current) => (current ? { ...current, step: "notes" } : current));
        }}
        onToggleProjectField={(field) => {
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
        }}
        onToggleCommand={(index) => {
          setImportWizard((current) =>
            current
              ? {
                  ...current,
                  selectedCommandIndexes: toggleSelectedIndex(current.selectedCommandIndexes, index),
                }
              : current,
          );
        }}
        onToggleNote={(index) => {
          setImportWizard((current) =>
            current
              ? {
                  ...current,
                  selectedNoteIndexes: toggleSelectedIndex(current.selectedNoteIndexes, index),
                }
              : current,
          );
        }}
        onSubmit={handleImportWizardSubmit}
      />

      <OverwritePreviewDialog
        preview={overwritePreview}
        isPending={importProjectMutation.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setOverwritePreview(null);
          }
        }}
        onConfirm={() => {
          if (!overwritePreview) {
            return;
          }
          importProjectMutation.mutate({
            ...overwritePreview.request,
            overwrite_confirmed: true,
          });
        }}
      />

      {errorMessage && (
        <div className="toast" role="alert">
          <span>{errorMessage}</span>
          <Button size="sm" variant="ghost" onClick={() => setErrorMessage(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDialog.isOpen}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, isOpen: open }))}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmLabel={confirmDialog.confirmLabel}
        cancelLabel={confirmDialog.cancelLabel}
        onConfirm={confirmDialog.onConfirm}
        isDestructive={confirmDialog.isDestructive}
      />

      <KillPortsDialog
        open={killPortsDialogOpen}
        onOpenChange={setKillPortsDialogOpen}
        command={killPortsCommand}
        processes={portProcesses}
        onKill={handleKillProcesses}
        isKilling={killingPorts}
        onRefresh={handleRefreshProcesses}
      />
    </main>
  );
}

function EntityAvatar({ name, path }: { name: string; path?: string | null }) {
  const iconOption = lucideIconOption(path);
  const Icon = iconOption?.Icon;

  return (
    <Avatar>
      <AvatarImage src={avatarSrc(path)} alt="" />
      <AvatarFallback>{Icon ? <Icon size={20} /> : initials(name) || "PR"}</AvatarFallback>
    </Avatar>
  );
}

function CommandCard({
  command,
  onDelete,
  onEdit,
  onKillPorts,
  onRestart,
  onRun,
  onStop,
  onOpenLogs,
  run,
  isStopping = false,
  isRestarting = false,
  isScanningPorts = false,
}: {
  command: ProjectCommand;
  onDelete: () => void;
  onEdit: () => void;
  onKillPorts: () => void;
  onRestart: () => void;
  onRun: () => void;
  onStop: () => void;
  onOpenLogs: () => void;
  run?: RunState;
  isStopping?: boolean;
  isRestarting?: boolean;
  isScanningPorts?: boolean;
}) {
  const isRunning = run?.status === "running";
  const badgeVariant = isRunning ? "success" : run?.status === "failed" ? "danger" : "muted";
  const ports = commandPorts(command);

  return (
    <Card
      className={`draggable-card ${isRunning ? "running" : ""} ${run?.status === "failed" ? "failed" : ""}`}
    >
      <CardHeader className="command-card-header">
        <div className="title-cluster">
          <EntityAvatar name={command.name} path={command.avatar_path} />
          <div>
            <h3>{command.name}</h3>
            <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", marginTop: "2px" }}>
              <Badge variant={badgeVariant}>{run?.status ?? "ready"}</Badge>
              {Boolean(command.run_in_external_terminal) && (
                <Badge variant="muted" title="Runs in external terminal">External</Badge>
              )}
            </div>
          </div>
        </div>
        <div className="icon-menu">
          <Button size="icon" variant="ghost" onClick={onEdit} aria-label="Edit command">
            <Pencil size={16} />
          </Button>
          <Button size="icon" variant="ghost" onClick={onDelete} aria-label="Delete command">
            <Trash2 size={16} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {ports.length > 0 && (
          <div className="port-list">
            {ports.map((port) => (
              <Badge key={port} variant="muted">
                :{port}
              </Badge>
            ))}
          </div>
        )}
        <pre className="script-preview">{command.script}</pre>
        <div className="card-actions">
          {isRunning ? (
            <Button size="sm" variant="danger" className="btn-stop" onClick={onStop} disabled={isStopping}>
              {isStopping ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Stopping
                </>
              ) : (
                <>
                  <Square size={14} />
                  Stop
                </>
              )}
            </Button>
          ) : (
            <Button size="sm" onClick={onRun}>
              <Play size={14} />
              Run
            </Button>
          )}
          {isRunning && (
            <Button
              size="sm"
              variant="secondary"
              onClick={onRestart}
              disabled={isRestarting}
            >
              {isRestarting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Restarting...
                </>
              ) : (
                <>
                  <RotateCcw size={14} />
                  Rerun
                </>
              )}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={onKillPorts}
            disabled={ports.length === 0 || isScanningPorts}
          >
            {isScanningPorts ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <Trash2 size={14} />
                Kill ports
              </>
            )}
          </Button>
          <Button size="sm" variant="secondary" onClick={onOpenLogs}>
            <Terminal size={14} />
            Logs
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
function LogPanel({
  activeCommandId,
  commands,
  logs,
  openCommandIds,
  onActiveCommandChange,
  onClear,
  onCloseTab,
  runs,
  theme,
  showLogsTimestamp = false,
  showStreamName = true,
}: {
  activeCommandId: number | null;
  commands: ProjectCommand[];
  logs: LogLine[];
  openCommandIds: number[];
  onActiveCommandChange: (commandId: number) => void;
  onClear: (commandId: number) => void;
  onCloseTab: (commandId: number) => void;
  runs: Record<number, RunState>;
  theme: "light" | "dark";
  showLogsTimestamp?: boolean;
  showStreamName?: boolean;
}) {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const [panelHeight, setPanelHeight] = useState(() => {
    const saved = localStorage.getItem("logPanelHeight");
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed)) {
        return Math.max(150, Math.min(800, parsed));
      }
    }
    return 350;
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    localStorage.setItem("logPanelHeight", String(panelHeight));
  }, [panelHeight]);

  const startResize = (mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    setIsResizing(true);
    const startY = mouseDownEvent.clientY;
    const startHeight = panelHeight;

    const doResize = (mouseMoveEvent: MouseEvent) => {
      const deltaY = mouseMoveEvent.clientY - startY;
      const newHeight = Math.max(150, Math.min(800, startHeight - deltaY));
      setPanelHeight(newHeight);
    };

    const stopResize = () => {
      setIsResizing(false);
      window.removeEventListener("mousemove", doResize);
      window.removeEventListener("mouseup", stopResize);
    };

    window.addEventListener("mousemove", doResize);
    window.addEventListener("mouseup", stopResize);
  };

  const handleDoubleClick = () => {
    setPanelHeight(350);
  };

  const visibleCommands = useMemo(() => {
    const commandIdsWithLogs = new Set(logs.map((line) => line.commandId));
    const openCommandIdSet = new Set(openCommandIds);
    return commands.filter(
      (command) => openCommandIdSet.has(command.id) || commandIdsWithLogs.has(command.id) || runs[command.id],
    );
  }, [commands, logs, openCommandIds, runs]);
  const selectedCommand = visibleCommands.find((command) => command.id === activeCommandId) ?? visibleCommands[0] ?? null;
  const selectedCommandId = selectedCommand?.id ?? null;
  const selectedLogs = useMemo(
    () => logs.filter((line) => line.commandId === selectedCommandId).slice(-500),
    [logs, selectedCommandId],
  );

  useEffect(() => {
    const terminalBody = terminalRef.current?.querySelector(".react-terminal");
    terminalBody?.scrollTo({ top: terminalBody.scrollHeight, behavior: "smooth" });
  }, [selectedLogs]);

  useEffect(() => {
    if (selectedCommandId && selectedCommandId !== activeCommandId) {
      onActiveCommandChange(selectedCommandId);
    }
  }, [activeCommandId, onActiveCommandChange, selectedCommandId]);

  return (
    <aside className="log-panel" style={{ height: panelHeight }}>
      <div
        className={`terminal-resize-handle ${isResizing ? "active" : ""}`}
        onMouseDown={startResize}
        onDoubleClick={handleDoubleClick}
        title="Drag to resize, double click to reset"
      />
      {visibleCommands.length === 0 ? (
        <>
          <div className="log-header">
            <h3>Terminal Output</h3>
          </div>
          <div className="log-terminal" ref={terminalRef}>
            <TerminalUi colorMode={theme === "light" ? ColorMode.Light : ColorMode.Dark} height="100%" name="Output" prompt="" TopButtonsPanel={() => null}>
              <TerminalOutput>
                <span className="terminal-muted">Run a command to open its terminal tab.</span>
              </TerminalOutput>
            </TerminalUi>
          </div>
        </>
      ) : (
        <Tabs
          className="terminal-tabs"
          value={String(selectedCommandId)}
          onValueChange={(value) => onActiveCommandChange(Number(value))}
        >
          <div className="log-header">
            <TabsList className="terminal-tabs-list">
              {visibleCommands.map((command) => (
                <TabsTrigger className="terminal-tabs-trigger" key={command.id} value={String(command.id)}>
                  <span>{command.name}</span>
                  {runs[command.id]?.status === "running" && <span className="terminal-tab-status" />}
                  <button
                    className="close-tab-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(command.id);
                    }}
                    title="Close tab and stop process"
                  >
                    &times;
                  </button>
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="log-actions">
              <Button
                size="sm"
                variant="secondary"
                disabled={!selectedCommandId}
                onClick={() => selectedCommandId && onClear(selectedCommandId)}
              >
                Clear
              </Button>
            </div>
          </div>
          {selectedCommand && (
            <TabsContent className="terminal-tabs-content" value={String(selectedCommand.id)}>
              <div className="log-terminal" key={selectedCommand.id} ref={terminalRef}>
                <TerminalUi
                  colorMode={theme === "light" ? ColorMode.Light : ColorMode.Dark}
                  height="100%"
                  name={selectedCommand.name}
                  prompt=""
                  TopButtonsPanel={() => null}
                >
                  {selectedLogs.length === 0 ? (
                    <TerminalOutput>
                      <span className="terminal-muted">Waiting for output...</span>
                    </TerminalOutput>
                  ) : (
                    selectedLogs.map((line) => (
                      <TerminalOutput key={line.id}>
                        <span className={`terminal-stream ${line.stream}`}>
                          {showLogsTimestamp && <span className="terminal-timestamp" style={{ opacity: 0.5, marginRight: "4px" }}>[{line.timestamp}]</span>}
                          {showStreamName && <span className="terminal-stream-name">[{line.stream}] </span>}
                          {line.line}
                        </span>
                      </TerminalOutput>
                    ))
                  )}
                </TerminalUi>
              </div>
            </TabsContent>
          )}
        </Tabs>
      )}
    </aside>
  );
}

function ProjectDialog({
  open,
  project,
  isPending,
  onDelete,
  onError,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  project: Project | null;
  isPending: boolean;
  onDelete: (project: Project) => void;
  onError: (error: unknown) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: ProjectInput) => void;
}) {
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: project?.name ?? "",
      path: project?.path ?? "",
      description: project?.description ?? "",
      avatar_path: project?.avatar_path ?? null,
    },
  });
  const avatar = form.watch("avatar_path");

  async function pickFolder() {
    const path = await api.pickProjectFolder();
    if (path) {
      form.setValue("path", path, { shouldValidate: true });
    }
  }

  async function pickAvatar() {
    try {
      const path = await api.pickAndCopyAvatar("project", project?.id);
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{project ? "Edit project" : "Add project"}</DialogTitle>
          <DialogDescription>Save a folder you work in and group its commands.</DialogDescription>
        </DialogHeader>
        <form className="form" onSubmit={form.handleSubmit((values) => onSubmit(values))}>
          <AvatarPicker
            name={form.watch("name") || "Project"}
            avatarPath={avatar}
            onPickImage={pickAvatar}
            onPickIcon={pickIcon}
          />
          <FieldError message={form.formState.errors.name?.message} />
          <Label>Name</Label>
          <Input {...form.register("name")} placeholder="Frontend app" />

          <FieldError message={form.formState.errors.path?.message} />
          <Label>Folder</Label>
          <div className="inline-field">
            <Input {...form.register("path")} placeholder="E:\\UserData\\Documents\\DEV\\my-app" />
            <Button type="button" variant="secondary" onClick={pickFolder}>
              <FolderOpen size={16} />
            </Button>
          </div>

          <Label>Description</Label>
          <Textarea {...form.register("description")} rows={3} placeholder="Optional notes" />

          <div className="dialog-actions">
            {project && (
              <Button type="button" variant="danger" onClick={() => onDelete(project)}>
                <Trash2 size={16} />
                Delete
              </Button>
            )}
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CommandDialog({
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
      section: command?.section ?? defaultSection ?? (availableSections.includes(DEFAULT_SECTION) ? DEFAULT_SECTION : availableSections[0] ?? DEFAULT_SECTION),
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
      <DialogContent className="wide-dialog">
        <DialogHeader>
          <DialogTitle>{command ? "Edit command" : "Add command"}</DialogTitle>
          <DialogDescription>Paste the same multi-line script you would paste into a terminal.</DialogDescription>
        </DialogHeader>
        <form
          className="form"
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
          <FieldError message={form.formState.errors.name?.message} />
          <Label>Name</Label>
          <Input {...form.register("name")} placeholder="Run front-end" />

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

          <Label>Ports</Label>
          <Input {...form.register("ports")} placeholder="3000, 5173, 8080" />

          <FieldError message={form.formState.errors.script?.message} />
          <Label>Script</Label>
          <Textarea
            {...form.register("script")}
            className="script-input"
            rows={10}
            placeholder={"cd frontend\nnpm run dev"}
          />

          <div className="toggle-item" style={{ borderBottom: "none", paddingBottom: 0, marginTop: "6px" }}>
            <div className="toggle-info">
              <h4>Run via external terminal</h4>
              <p>Launch a new OS terminal window to run this command (useful for interactive CLI tools)</p>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                {...form.register("run_in_external_terminal")}
              />
              <span className="slider round" />
            </label>
          </div>

          <div className="dialog-actions">
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ExportProjectDialog({
  isPending,
  open,
  project,
  onOpenChange,
  onSave,
}: {
  isPending: boolean;
  open: boolean;
  project: Project;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export project</DialogTitle>
          <DialogDescription>Save this project and its commands as a .prd file.</DialogDescription>
        </DialogHeader>
        <div className="summary-panel">
          <EntityAvatar name={project.name} path={project.avatar_path} />
          <div>
            <strong>{project.name}</strong>
            <span>{project.path}</span>
          </div>
        </div>
        <div className="dialog-actions">
          <Button onClick={onSave} disabled={isPending}>
            {isPending ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImportProjectDialog({
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import project</DialogTitle>
          <DialogDescription>Review the .prd file before adding it to the app.</DialogDescription>
        </DialogHeader>
        {preview && (
          <>
            <div className="import-details">
              <div>
                <span>Project</span>
                <strong>{preview.project_name}</strong>
              </div>
              <div>
                <span>Folder</span>
                <strong>{preview.project_path}</strong>
              </div>
              <div>
                <span>Commands</span>
                <strong>{preview.command_diffs.length}</strong>
              </div>
              <div>
                <span>Notes</span>
                <strong>{preview.note_diffs.length}</strong>
              </div>
              <div>
                <span>Sections</span>
                <strong>{preview.sections.length > 0 ? preview.sections.join(", ") : DEFAULT_SECTION}</strong>
              </div>
            </div>
            {preview.description && <p className="project-description preview-description">{preview.description}</p>}
            <div className="dialog-actions">
              <Button onClick={() => onImport(preview)} disabled={isPending}>
                {isPending ? <Loader2 className="spin" size={16} /> : <FileInput size={16} />}
                Import
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

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

function ImportWizardDialog({
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
            <div className="import-wizard-summary">
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

            <div className="import-wizard-stepper">
              <button
                type="button"
                className={`import-step ${wizard.step === "commands" ? "active" : ""}`}
                onClick={onBack}
              >
                1. Commands
              </button>
              <button
                type="button"
                className={`import-step ${wizard.step === "notes" ? "active" : ""}`}
                onClick={onNext}
              >
                2. Notes
              </button>
            </div>

            {analysis.project_field_changes.length > 0 && isCommandsStep && (
              <div className="import-project-fields">
                <div className="import-pane-header">
                  <div>
                    <h3>Project details</h3>
                    <p>Choose whether to update the current project metadata before importing commands.</p>
                  </div>
                </div>
                <div className="import-field-list">
                  {analysis.project_field_changes.map((change) => {
                    const checked = wizard.selectedProjectFields.includes(change.field);
                    return (
                      <label key={change.field} className="import-field-item">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleProjectField(change.field)}
                        />
                        <div className="import-field-copy">
                          <div className="import-field-row">
                            <strong>{change.label}</strong>
                            <Badge
                              variant={
                                change.status === "overwrite"
                                  ? "danger"
                                  : "success"
                              }
                            >
                              {change.status === "overwrite"
                                ? "Overwrite"
                                : "New"}
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
            )}

            {isCommandsStep ? (
              <div className="import-diff-layout">
                <div className="import-pane-header">
                  <div>
                    <h3>Commands</h3>
                    <p>Left is your current project, right is the content from the `.prd` file.</p>
                  </div>
                </div>
                <div className="import-diff-list">
                  {analysis.command_diffs.map((diff) => {
                    const checked = wizard.selectedCommandIndexes.includes(diff.index);
                    return (
                      <label key={`command-${diff.index}`} className="import-diff-item">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleCommand(diff.index)}
                        />
                        <div className="import-diff-panels">
                          <div className="import-diff-panel">
                            <div className="import-card-head">
                              <span>Current</span>
                              {diff.existing ? (
                                <strong>
                                  {diff.existing.section} / {diff.existing.name}
                                </strong>
                              ) : (
                                <strong>No matching command</strong>
                              )}
                            </div>
                            {diff.existing ? (
                              <div className="import-card-body">
                                <span>{formatPorts(diff.existing.ports)}</span>
                                <span>{diff.existing.run_in_external_terminal ? "External terminal" : "Inline terminal"}</span>
                                {diff.existing.avatar_label && <span>{diff.existing.avatar_label}</span>}
                                <pre>{diff.existing.script}</pre>
                              </div>
                            ) : (
                              <div className="import-card-empty">This command does not exist yet.</div>
                            )}
                          </div>
                          <div className="import-diff-panel incoming">
                            <div className="import-card-head">
                              <span>Incoming</span>
                              <strong>
                                {diff.incoming.section} / {diff.incoming.name}
                              </strong>
                              <Badge variant={importStatusVariant(diff.status)}>
                                {importStatusLabel(diff.status)}
                              </Badge>
                            </div>
                            <div className="import-card-body">
                              <span>{formatPorts(diff.incoming.ports)}</span>
                              <span>{diff.incoming.run_in_external_terminal ? "External terminal" : "Inline terminal"}</span>
                              {diff.incoming.avatar_label && <span>{diff.incoming.avatar_label}</span>}
                              {diff.overwrite_fields.length > 0 && (
                                <span>Changes: {diff.overwrite_fields.join(", ")}</span>
                              )}
                              <pre>{diff.incoming.script}</pre>
                            </div>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="import-diff-layout">
                <div className="import-pane-header">
                  <div>
                    <h3>Notes</h3>
                    <p>Pick the notes you want to merge in from the `.prd` file.</p>
                  </div>
                </div>
                <div className="import-diff-list">
                  {analysis.note_diffs.map((diff) => {
                    const checked = wizard.selectedNoteIndexes.includes(diff.index);
                    return (
                      <label key={`note-${diff.index}`} className="import-diff-item">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleNote(diff.index)}
                        />
                        <div className="import-diff-panels">
                          <div className="import-diff-panel">
                            <div className="import-card-head">
                              <span>Current</span>
                              <strong>{diff.existing ? diff.existing.id : "No matching note"}</strong>
                            </div>
                            {diff.existing ? (
                              <div className="import-card-body">
                                <span>{diff.existing.pinned ? "Pinned" : "Not pinned"}</span>
                                <span>{new Date(diff.existing.updatedAt).toLocaleString()}</span>
                                <pre>{diff.existing.content}</pre>
                              </div>
                            ) : (
                              <div className="import-card-empty">This note does not exist yet.</div>
                            )}
                          </div>
                          <div className="import-diff-panel incoming">
                            <div className="import-card-head">
                              <span>Incoming</span>
                              <strong>{diff.incoming.id}</strong>
                              <Badge variant={importStatusVariant(diff.status)}>
                                {importStatusLabel(diff.status)}
                              </Badge>
                            </div>
                            <div className="import-card-body">
                              <span>{diff.incoming.pinned ? "Pinned" : "Not pinned"}</span>
                              <span>{new Date(diff.incoming.updatedAt).toLocaleString()}</span>
                              {diff.overwrite_fields.length > 0 && (
                                <span>Changes: {diff.overwrite_fields.join(", ")}</span>
                              )}
                              <pre>{diff.incoming.content}</pre>
                            </div>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="dialog-actions">
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
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OverwritePreviewDialog({
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
            {preview.projectFields.length > 0 && (
              <div className="overwrite-section">
                <h3>Project details</h3>
                <div className="overwrite-grid">
                  {preview.projectFields.map((field) => (
                    <div key={field.field} className="overwrite-card">
                      <strong>{field.label}</strong>
                      <span>Current: {formatImportValue(field.existing_value)}</span>
                      <span>Incoming: {formatImportValue(field.incoming_value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {preview.commands.length > 0 && (
              <div className="overwrite-section">
                <h3>Commands</h3>
                <div className="overwrite-grid">
                  {preview.commands.map((diff) => (
                    <div key={`command-overwrite-${diff.index}`} className="overwrite-card">
                      <strong>
                        {diff.incoming.section} / {diff.incoming.name}
                      </strong>
                      <span>Fields: {diff.overwrite_fields.join(", ")}</span>
                      <span>Current script:</span>
                      <pre>{diff.existing?.script ?? "None"}</pre>
                      <span>Incoming script:</span>
                      <pre>{diff.incoming.script}</pre>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {preview.notes.length > 0 && (
              <div className="overwrite-section">
                <h3>Notes</h3>
                <div className="overwrite-grid">
                  {preview.notes.map((diff) => (
                    <div key={`note-overwrite-${diff.index}`} className="overwrite-card">
                      <strong>{diff.incoming.id}</strong>
                      <span>Fields: {diff.overwrite_fields.join(", ")}</span>
                      <span>Current:</span>
                      <pre>{diff.existing?.content ?? "None"}</pre>
                      <span>Incoming:</span>
                      <pre>{diff.incoming.content}</pre>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="dialog-actions">
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Back
              </Button>
              <Button type="button" variant="danger" onClick={onConfirm} disabled={isPending}>
                {isPending ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
                Confirm overwrite and import
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AvatarPicker({
  name,
  avatarPath,
  onPickIcon,
  onPickImage,
}: {
  name: string;
  avatarPath?: string | null;
  onPickIcon: (iconId: string) => void;
  onPickImage: () => void;
}) {
  const selectedIconId = lucideIconId(avatarPath);

  return (
    <div className="avatar-picker">
      <div className="avatar-picker-preview">
        <EntityAvatar name={name} path={avatarPath} />
        <Button type="button" variant="secondary" onClick={onPickImage}>
          <ImagePlus size={16} />
          Image
        </Button>
      </div>
      <span className="icon-picker-label">Add icon</span>
      <div className="icon-picker" aria-label="Add icon">
        {iconOptions.map(({ id, label, Icon }) => (
          <button
            aria-label={label}
            className={`icon-choice ${selectedIconId === id ? "active" : ""}`}
            key={id}
            onClick={() => onPickIcon(id)}
            title={label}
            type="button"
          >
            <Icon size={18} />
          </button>
        ))}
      </div>
    </div>
  );
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  isDestructive = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  isDestructive?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="confirm-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="dialog-actions">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={isDestructive ? "danger" : "default"}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KillPortsDialog({
  open,
  onOpenChange,
  command,
  processes,
  onKill,
  isKilling,
  onRefresh,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  command: ProjectCommand | null;
  processes: PortProcess[];
  onKill: (pids: number[]) => void;
  isKilling: boolean;
  onRefresh: () => void;
}) {
  const [selectedPids, setSelectedPids] = useState<Set<number>>(new Set());

  useEffect(() => {
    setSelectedPids(new Set(processes.map((p) => p.pid)));
  }, [processes]);

  if (!command) return null;

  const toggleSelectAll = () => {
    if (selectedPids.size === processes.length) {
      setSelectedPids(new Set());
    } else {
      setSelectedPids(new Set(processes.map((p) => p.pid)));
    }
  };

  const toggleSelectPid = (pid: number) => {
    setSelectedPids((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) {
        next.delete(pid);
      } else {
        next.add(pid);
      }
      return next;
    });
  };

  const ports = commandPorts(command);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="kill-ports-dialog wide-dialog">
        <DialogHeader>
          <DialogTitle>Kill ports for "{command.name}"</DialogTitle>
          <DialogDescription>
            Scan results for ports: {ports.map((p) => `:${p}`).join(", ")}
          </DialogDescription>
        </DialogHeader>

        <div className="kill-ports-content">
          {processes.length === 0 ? (
            <div className="no-processes-state">
              <Check className="success-icon animate-bounce-subtle" size={24} />
              <p>No active processes found using these ports.</p>
            </div>
          ) : (
            <div className="processes-list-wrapper">
              <div className="processes-list-header">
                <label className="checkbox-container">
                  <input
                    type="checkbox"
                    checked={selectedPids.size === processes.length && processes.length > 0}
                    onChange={toggleSelectAll}
                    disabled={isKilling}
                  />
                  <span className="checkbox-label">Select All ({processes.length})</span>
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onRefresh}
                  disabled={isKilling}
                  type="button"
                >
                  Refresh
                </Button>
              </div>

              <div className="processes-list">
                {processes.map((proc) => {
                  const isChecked = selectedPids.has(proc.pid);
                  return (
                    <div
                      key={`${proc.pid}-${proc.port}`}
                      className={`process-item-row ${isChecked ? "selected" : ""}`}
                      onClick={() => !isKilling && toggleSelectPid(proc.pid)}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        disabled={isKilling}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="process-details">
                        <span className="process-name">{proc.name}</span>
                        <span className="process-meta">
                          PID: <code>{proc.pid}</code> | Port: <code>:{proc.port}</code>
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="danger"
                        className="single-kill-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onKill([proc.pid]);
                        }}
                        disabled={isKilling}
                      >
                        Kill
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="dialog-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={isKilling}
          >
            Close
          </Button>
          {processes.length > 0 && (
            <Button
              type="button"
              variant="danger"
              disabled={selectedPids.size === 0 || isKilling}
              onClick={() => onKill(Array.from(selectedPids))}
            >
              {isKilling ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Killing...
                </>
              ) : (
                `Kill Selected (${selectedPids.size})`
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="field-error">{message}</p> : null;
}

export default App;
