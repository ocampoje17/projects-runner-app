import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BookOpenText,
  ChevronDown,
  ChevronRight,
  CopyPlus,
  Eye,
  EyeOff,
  FilePenLine,
  FileUp,
  FolderKanban,
  GitBranch,
  FolderOpen,
  LayoutGrid,
  ListTree,
  Pencil,
  Pin,
  PinOff,
  Plus,
  PowerOff,
  RotateCcw,
  Search,
  Square,
  Settings2,
  Trash2,
  TerminalSquare,
  Play,
  X,
} from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { SettingsPageProps, SettingsSectionId } from "./SettingsPage";
import { SettingsPage } from "./SettingsPage";
import { EntityAvatar } from "./entity-avatar";
import { Tooltip } from "./motion/tooltip";
import { ProjectDetailNotes, ProjectNoteDialog } from "./project-detail-notes";
import type { CommandSection, ProjectNote } from "./project-detail-types";
import { CommandCard, LogPanel, type RunState } from "./project-runtime";
import { FlowLauncher } from "./flow-launcher";
import { FlowFormDialog } from "./flow-form-dialog";
import { FlowsOverviewPane } from "./flows-overview";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { commandPorts, normalizeCommandScript, runtimeModeLabel } from "@/lib/command-utils";
import { formatDateTime } from "@/lib/date-time";
import { noteExcerpt, noteTitle, projectNoteVisibilityKey } from "@/lib/project-notes";
import { cn } from "@/lib/utils";
import { api, type Project, type ProjectCommand, type ProjectFlow } from "../lib/api";
import type { InteractiveTerminalKind, InteractiveTerminalOption } from "../lib/interactive-terminal";
import type { UpdateStatus } from "../hooks/use-app-updater";
import type { FlowRunState } from "../hooks/use-flow-runtime";

type SidebarView = "explorer" | "flows" | "notes" | "terminal" | "settings";

export type VSCodeShellHandle = {
  openProject: (projectId: number) => void;
  openCommand: (projectId: number, commandId: number) => void;
  openNote: (projectId: number, noteId: string) => void;
  openFlow: (projectId: number, flowId: number) => void;
};

type EditorTab =
  | { id: string; kind: "welcome"; title: string }
  | { id: string; kind: "project-overview"; title: string; projectId: number }
  | { id: string; kind: "commands-overview"; title: string; projectId: number }
  | { id: string; kind: "notes-overview"; title: string; projectId: number }
  | { id: string; kind: "flows-overview"; title: string; projectId: number }
  | { id: string; kind: "command"; title: string; projectId: number; commandId: number }
  | { id: string; kind: "note"; title: string; projectId: number; noteId: string }
  | { id: string; kind: "flow"; title: string; projectId: number; flowId: number }
  | { id: string; kind: "settings"; title: string };

const SIDEBAR_VIEW_KEY = "vscodeSidebarView";
const SIDEBAR_LAYOUT_KEY = "vscodeSidebarLayout";
const DEFAULT_SIDEBAR_LAYOUT = { sidebar: 28, editor: 72 } as const;
const SIDEBAR_MIN_LAYOUT = 18;
const SIDEBAR_MAX_LAYOUT = 52;
const EDITOR_MIN_LAYOUT = 30;
const SIDEBAR_DEFAULT_SIZE = "28%";
const SIDEBAR_MIN_SIZE = "18%";
const SIDEBAR_MAX_SIZE = "52%";
const EDITOR_MIN_SIZE = "30%";

function readSidebarLayout() {
  if (typeof window === "undefined") {
    return DEFAULT_SIDEBAR_LAYOUT;
  }

  try {
    const raw = localStorage.getItem(SIDEBAR_LAYOUT_KEY);
    if (!raw) {
      return DEFAULT_SIDEBAR_LAYOUT;
    }
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.sidebar === "number" &&
      typeof parsed.editor === "number" &&
      parsed.sidebar >= SIDEBAR_MIN_LAYOUT &&
      parsed.sidebar <= SIDEBAR_MAX_LAYOUT &&
      parsed.editor >= EDITOR_MIN_LAYOUT
    ) {
      return parsed as { sidebar: number; editor: number };
    }
  } catch {
    return DEFAULT_SIDEBAR_LAYOUT;
  }

  return DEFAULT_SIDEBAR_LAYOUT;
}

function projectOverviewTab(project: Project): EditorTab {
  return { id: `project-overview:${project.id}`, kind: "project-overview", projectId: project.id, title: project.name };
}

function commandsOverviewTab(project: Project): EditorTab {
  return { id: `commands-overview:${project.id}`, kind: "commands-overview", projectId: project.id, title: `${project.name} Commands` };
}

function notesOverviewTab(project: Project): EditorTab {
  return { id: `notes-overview:${project.id}`, kind: "notes-overview", projectId: project.id, title: `${project.name} Notes` };
}

function flowsOverviewTab(project: Project): EditorTab {
  return { id: `flows-overview:${project.id}`, kind: "flows-overview", projectId: project.id, title: `${project.name} Flows` };
}

function flowTab(project: Project, flow: ProjectFlow): EditorTab {
  return { id: `flow:${flow.id}`, kind: "flow", projectId: project.id, flowId: flow.id, title: flow.name };
}

function settingsTab(): EditorTab {
  return { id: "settings", kind: "settings", title: "Settings" };
}

function welcomeTab(): EditorTab {
  return { id: "welcome", kind: "welcome", title: "Welcome" };
}

function getProjectIdFromTab(tab: EditorTab): number | null {
  return "projectId" in tab ? tab.projectId : null;
}

function resolveNextActiveTabId(currentTabs: EditorTab[], closingTabId: string, activeTabId: string) {
  if (activeTabId !== closingTabId) {
    return activeTabId;
  }

  const closingIndex = currentTabs.findIndex((tab) => tab.id === closingTabId);
  const remainingTabs = currentTabs.filter((tab) => tab.id !== closingTabId);

  if (remainingTabs.length === 0) {
    return welcomeTab().id;
  }

  const fallbackIndex = closingIndex >= remainingTabs.length ? remainingTabs.length - 1 : closingIndex;
  return remainingTabs[Math.max(fallbackIndex, 0)]!.id;
}

function findProjectById(projects: Project[], projectId?: number) {
  return projects.find((project) => project.id === projectId) ?? null;
}

function findCommandById(commands: ProjectCommand[], commandId?: number) {
  return commands.find((command) => command.id === commandId) ?? null;
}

function findNoteById(notes: ProjectNote[], noteId?: string) {
  return notes.find((note) => note.id === noteId) ?? null;
}

type CommandSortField = "runCount" | "updatedAt" | "createdAt" | "name";
type CommandSortDirection = "desc" | "asc";

const COMMAND_SORT_FIELD_OPTIONS: { value: CommandSortField; label: string }[] = [
  { value: "runCount", label: "Run count" },
  { value: "updatedAt", label: "Updated time" },
  { value: "createdAt", label: "Created time" },
  { value: "name", label: "Name" },
];

const COMMAND_SORT_DIRECTION_OPTIONS: { value: CommandSortDirection; label: string }[] = [
  { value: "desc", label: "Descending" },
  { value: "asc", label: "Ascending" },
];

type CommandOverviewMeta = {
  id: number;
  searchText: string;
  section: string;
  runCount: number;
  createdAtMs: number;
  updatedAtMs: number;
  name: string;
};

function buildCommandOverviewMeta(command: ProjectCommand): CommandOverviewMeta {
  return {
    id: command.id,
    searchText: `${command.name}\n${command.section}\n${normalizeCommandScript(command.script)}`.toLocaleLowerCase(),
    section: command.section,
    runCount: command.run_count,
    createdAtMs: new Date(command.created_at).getTime(),
    updatedAtMs: new Date(command.updated_at).getTime(),
    name: command.name,
  };
}

function compareCommandOverviewMeta(
  left: CommandOverviewMeta,
  right: CommandOverviewMeta,
  sortField: CommandSortField,
  sortDirection: CommandSortDirection,
) {
  let result = 0;

  switch (sortField) {
    case "runCount":
      result = left.runCount - right.runCount;
      break;
    case "createdAt":
      result = left.createdAtMs - right.createdAtMs;
      break;
    case "updatedAt":
      result = left.updatedAtMs - right.updatedAtMs;
      break;
    case "name":
      result = left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true });
      break;
  }

  if (result === 0) {
    result = left.updatedAtMs - right.updatedAtMs;
  }
  if (result === 0) {
    result = left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true });
  }

  return sortDirection === "asc" ? result : -result;
}

function formatRunCountLabel(runCount: number) {
  return `${runCount} run${runCount === 1 ? "" : "s"}`;
}

function MarkdownPreview({ content, className }: { content: string; className?: string }) {
  return (
    <div
      className={cn(
        "markdown-note rounded-[6px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] px-4 py-3 text-[12px] leading-6 text-foreground",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function OverviewCommandRow({
  command,
  run,
  onOpenDetail,
  onRun,
  onStop,
}: {
  command: ProjectCommand;
  run?: RunState;
  onOpenDetail: () => void;
  onRun: () => void;
  onStop: () => void;
}) {
  const isRunning = run?.status === "running";

  return (
    <div className="flex items-center gap-3 border-b border-[var(--vscode-border)] px-1 py-3 last:border-b-0">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-[8px] border border-transparent px-3 py-2 text-left transition-[background-color,border-color] hover:border-[var(--vscode-border)] hover:bg-[var(--vscode-list-hover)] active:bg-[var(--vscode-list-active)]"
        onClick={onOpenDetail}
      >
        <EntityAvatar name={command.name} path={command.avatar_path} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[12.5px] font-semibold text-foreground">{command.name}</span>
            <Badge variant="muted" className="shrink-0">
              {command.section}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--vscode-foreground)]/58">
            <span>{formatRunCountLabel(command.run_count)}</span>
            <span aria-hidden="true">•</span>
            <span>{runtimeModeLabel(command.runtime_mode)}</span>
          </div>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="ghost" className="h-8 px-2.5 text-[11.5px]" onClick={onOpenDetail}>
          <Eye size={13} />
          View
        </Button>
        <Button
          size="sm"
          variant={isRunning ? "outline" : "primary"}
          className={cn("h-8 px-2.5", isRunning && "border-destructive text-destructive hover:bg-destructive/10")}
          onClick={isRunning ? onStop : onRun}
        >
          {isRunning ? <Square size={13} /> : <Play size={13} />}
          {isRunning ? "Stop" : "Run"}
        </Button>
      </div>
    </div>
  );
}

function OverviewNoteRow({
  note,
  onOpenNote,
}: {
  note: ProjectNote;
  onOpenNote: () => void;
}) {
  return (
    <div className="flex w-full items-center gap-3 border-b border-[var(--vscode-border)] px-1 py-3 last:border-b-0">
      <Tooltip content={`Updated ${formatDateTime(note.updatedAt)}`} wrapperClassName="flex min-w-0 flex-1">
        <button
          type="button"
          className="flex w-full min-w-0 flex-1 items-center gap-3 rounded-[8px] border border-transparent px-3 py-2 text-left transition-[background-color,border-color] hover:border-[var(--vscode-border)] hover:bg-[var(--vscode-list-hover)] active:bg-[var(--vscode-list-active)]"
          onClick={onOpenNote}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] text-[var(--vscode-foreground)]/72">
            <BookOpenText size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[12.5px] font-semibold text-foreground">{noteTitle(note)}</span>
              {note.pinned ? <Badge variant="muted">Pinned</Badge> : null}
            </div>
            <div className="mt-1 line-clamp-2 text-[11.5px] leading-5 text-[var(--vscode-foreground)]/64">
              {noteExcerpt(note)}
            </div>
          </div>
        </button>
      </Tooltip>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="ghost" className="h-8 px-2.5 text-[11.5px]" onClick={onOpenNote}>
          <Eye size={13} />
          View
        </Button>
      </div>
    </div>
  );
}

function SidebarIconButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={label} side="right">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cn(
          "group relative flex h-12 w-12 items-center justify-center overflow-hidden border-l border-transparent text-[var(--vscode-icon)] transition-[background-color,color,border-color,box-shadow] hover:border-[var(--vscode-border)] hover:bg-[color-mix(in_srgb,var(--vscode-list-hover)_78%,transparent)] hover:text-foreground active:bg-[var(--vscode-list-active)]",
          active && "border-[color-mix(in_srgb,var(--primary-color)_35%,var(--vscode-border))] bg-[color-mix(in_srgb,var(--vscode-list-selected)_82%,var(--vscode-activity))] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary-color)_18%,transparent)]",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full bg-primary opacity-0 transition-opacity duration-150",
            active && "opacity-100",
          )}
        />
        <span
          className={cn(
            "relative z-[1] transition-transform duration-150 group-hover:scale-[1.04] group-active:scale-[0.96]",
            active && "text-primary",
          )}
        >
          {children}
        </span>
      </button>
    </Tooltip>
  );
}

function TreeItem({
  level = 0,
  active,
  onClick,
  icon,
  title,
  trailing,
  menuItems,
}: {
  level?: number;
  active?: boolean;
  onClick?: () => void;
  icon?: React.ReactNode;
  title: string;
  trailing?: React.ReactNode;
  menuItems?: {
    label: string;
    icon?: React.ReactNode;
    onSelect: () => void;
    disabled?: boolean;
    tone?: "default" | "danger";
  }[];
}) {
  const [menuState, setMenuState] = useState<
    | { mode: "anchor" }
    | {
        mode: "context";
        x: number;
        y: number;
      }
    | null
  >(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const hasMenu = Boolean(menuItems?.length);
  const menuOpen = menuState !== null;

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setMenuState(null);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuState(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (menuState?.mode !== "context" || !menuRef.current) {
      return;
    }

    const rect = menuRef.current.getBoundingClientRect();
    const nextX = Math.min(menuState.x, window.innerWidth - rect.width - 8);
    const nextY = Math.min(menuState.y, window.innerHeight - rect.height - 8);

    if (nextX !== menuState.x || nextY !== menuState.y) {
      setMenuState({
        mode: "context",
        x: Math.max(8, nextX),
        y: Math.max(8, nextY),
      });
    }
  }, [menuState]);

  return (
    <div
      ref={containerRef}
      className="group/item relative"
      onContextMenu={(event) => {
        if (!hasMenu) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setMenuState({
          mode: "context",
          x: event.clientX,
          y: event.clientY,
        });
      }}
    >
      <div
        className={cn(
          "relative flex h-7 w-full items-center gap-1 rounded-[6px] border border-transparent pr-1 text-[12px] text-[var(--vscode-foreground)]/84 transition-[background-color,border-color,color] hover:border-[var(--vscode-border)] hover:bg-[var(--vscode-list-hover)] hover:text-foreground active:bg-[var(--vscode-list-active)]",
          active && "border-primary/35 bg-[var(--vscode-list-selected)] text-foreground",
          menuOpen && "border-[var(--vscode-border)] bg-[var(--vscode-list-hover)] text-foreground",
        )}
      >
        {active ? <span className="absolute inset-y-1 left-0 w-[2px] rounded-r-full bg-primary" /> : null}
        <button
          type="button"
          onClick={onClick}
          className="flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-[6px] px-2 text-left"
          style={{ paddingLeft: `${8 + level * 14}px` } as CSSProperties}
        >
          {icon ? <span className={cn("shrink-0 text-[var(--vscode-icon)]", active && "text-primary")}>{icon}</span> : null}
          <span className="truncate">{title}</span>
          {trailing ? <span className={cn("ml-auto shrink-0 text-[11px] text-muted-foreground", active && "text-foreground/80")}>{trailing}</span> : null}
        </button>
      </div>
      {hasMenu && menuOpen ? (
        <div
          ref={menuRef}
          className="z-[1000] min-w-[180px] overflow-hidden rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] p-1 shadow-[var(--split-menu-shadow)]"
          style={
            menuState.mode === "context"
              ? ({
                  position: "fixed",
                  left: menuState.x,
                  top: menuState.y,
                } as CSSProperties)
              : ({
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 4px)",
                } as CSSProperties)
          }
        >
          {menuItems?.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) {
                  return;
                }
                setMenuState(null);
                item.onSelect();
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12px] text-[var(--vscode-foreground)] transition-[background-color,color] hover:bg-[var(--vscode-list-hover)] hover:text-foreground active:bg-[var(--vscode-list-active)] disabled:cursor-not-allowed disabled:opacity-50",
                item.tone === "danger" &&
                  "text-[var(--vscode-danger)] hover:bg-[color-mix(in_srgb,var(--vscode-danger)_14%,transparent)] hover:text-[var(--vscode-danger)] active:bg-[color-mix(in_srgb,var(--vscode-danger)_22%,transparent)]",
              )}
            >
              {item.icon ? <span className="shrink-0">{item.icon}</span> : null}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EmptyEditorState({
  onAddProject,
  onImportProject,
}: {
  onAddProject: () => void;
  onImportProject: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-[var(--vscode-editor)] p-8">
      <div className="w-full max-w-[720px] rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] p-8">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] p-3 text-primary">
            <FolderKanban size={22} />
          </div>
          <div>
            <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-foreground">Projects Runner</h2>
            <p className="text-[13px] text-[var(--vscode-foreground)]/70">
              Organize local projects, run commands, and keep terminal context in one desktop workspace.
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Button variant="primary" className="justify-start" onClick={onAddProject}>
            <Plus size={16} />
            Add a local project
          </Button>
          <Button variant="secondary" className="justify-start" onClick={onImportProject}>
            <FileUp size={16} />
            Import a `.prd` workspace
          </Button>
        </div>
        <div className="mt-6 grid gap-2 text-[12px] text-[var(--vscode-foreground)]/72">
          <p>1. Add a project folder and keep its path, description, notes and commands together.</p>
          <p>2. Store one-line or multi-line scripts and run them in an integrated terminal panel.</p>
          <p>3. Reopen command logs, manage ports, and keep setup notes next to each project.</p>
        </div>
      </div>
    </div>
  );
}

function WelcomeEditor({
  onAddProject,
  onImportProject,
}: {
  onAddProject: () => void;
  onImportProject: () => void;
}) {
  return <EmptyEditorState onAddProject={onAddProject} onImportProject={onImportProject} />;
}

function ProjectOverviewPane({
  project,
  commands,
  notes,
  runs,
  onOpenCommand,
  onOpenNote,
  onOpenCommandsOverview,
  onOpenNotesOverview,
  onRunCommand,
  onStopCommand,
  onAddCommand,
  onOpenExplorer,
  onOpenTerminal,
  onShareProject,
  onEditProject,
}: {
  project: Project;
  commands: ProjectCommand[];
  notes: ProjectNote[];
  runs: Record<number, RunState>;
  onOpenCommand: (command: ProjectCommand) => void;
  onOpenNote: (note: ProjectNote) => void;
  onOpenCommandsOverview: () => void;
  onOpenNotesOverview: () => void;
  onRunCommand: (command: ProjectCommand) => void;
  onStopCommand: (command: ProjectCommand) => void;
  onAddCommand: () => void;
  onOpenExplorer: () => void;
  onOpenTerminal: () => void;
  onShareProject: () => void;
  onEditProject: () => void;
}) {
  const runningCommands = commands.filter((command) => runs[command.id]?.status === "running");
  const pinnedNotes = notes.filter((note) => note.pinned);
  const topCommands = useMemo(
    () =>
      [...commands]
        .sort((left, right) => {
          if (right.run_count !== left.run_count) {
            return right.run_count - left.run_count;
          }
          const updatedAtDiff = new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
          if (updatedAtDiff !== 0) {
            return updatedAtDiff;
          }
          return left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true });
        })
        .slice(0, 6),
    [commands],
  );
  const recentNotes = notes.slice(0, 6);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-[var(--vscode-editor)] px-6 py-5">
      <div className="mx-auto flex w-full max-w-[1260px] flex-col">
        <section className="py-1">
          <div className="space-y-4">
            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(320px,1.1fr)] xl:items-start">
              <div className="flex min-w-0 items-start gap-3">
                <EntityAvatar name={project.name} path={project.avatar_path} />
                <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                  <h2 className="truncate text-[22px] font-semibold tracking-[-0.02em] text-foreground">{project.name}</h2>
                  <Badge variant="muted" className="shrink-0">Workspace</Badge>
                </div>
              </div>
              <div className="min-w-0 xl:justify-self-end xl:text-right">
                <p className="truncate font-mono text-[11px] text-[var(--vscode-foreground)]/68">{project.path}</p>
                <p className="mt-1 truncate text-[12.5px] text-[var(--vscode-foreground)]/78">
                  {project.description || "Add a short description so teammates know what this workspace is for."}
                </p>
              </div>
            </div>

            <div className="h-px bg-[var(--vscode-border)]" aria-hidden="true" />

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={onOpenExplorer}>
                <FolderOpen size={15} />
                Reveal
              </Button>
              <Button variant="secondary" onClick={onOpenTerminal}>
                <TerminalSquare size={15} />
                External terminal
              </Button>
              <Button variant="secondary" onClick={onShareProject}>
                <FileUp size={15} />
                Export
              </Button>
              <Button variant="secondary" onClick={onEditProject}>
                <Pencil size={15} />
                Edit project
              </Button>
              <Button onClick={onAddCommand}>
                <Plus size={15} />
                Add command
              </Button>
            </div>

            <div className="h-px bg-[var(--vscode-border)]" aria-hidden="true" />

            <div className="grid sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Commands", value: commands.length },
                { label: "Running", value: runningCommands.length },
                { label: "Notes", value: notes.length },
                { label: "Pinned", value: pinnedNotes.length },
              ].map((item) => (
                <div key={item.label} className="border-r border-[var(--vscode-border)] px-4 py-3 last:border-r-0">
                  <div className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/50">{item.label}</div>
                  <div className="mt-1 text-[20px] font-semibold text-foreground">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="my-5 h-px bg-[var(--vscode-border)]" aria-hidden="true" />

        <section className="py-1">
          <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/78">Command workspace</h3>
                <p className="text-[11.5px] text-[var(--vscode-foreground)]/60">Frequently used run targets for this project.</p>
              </div>
              <Button size="sm" variant="secondary" onClick={onAddCommand}>
                <Plus size={14} />
                New command
              </Button>
            </div>
            <div className="mt-3 h-px bg-[var(--vscode-border)]" aria-hidden="true" />
            {commands.length > 0 ? (
              <div className="pt-2">
                {topCommands.map((command) => (
                  <OverviewCommandRow
                    key={command.id}
                    command={command}
                    run={runs[command.id]}
                    onOpenDetail={() => onOpenCommand(command)}
                    onRun={() => onRunCommand(command)}
                    onStop={() => onStopCommand(command)}
                  />
                ))}
                <div className="pt-4">
                  <Button variant="secondary" onClick={onOpenCommandsOverview}>
                    <LayoutGrid size={14} />
                    View all
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-[8px] border border-dashed border-[var(--vscode-border)] px-4 py-8 text-center text-[13px] text-[var(--vscode-foreground)]/68">
                No commands yet. Add your first reusable script for this project.
              </div>
            )}
        </section>

        <div className="my-5 h-px bg-[var(--vscode-border)]" aria-hidden="true" />

        <section className="py-1">
          <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/78">Project notes</h3>
                <p className="text-[11.5px] text-[var(--vscode-foreground)]/60">Setup details, onboarding steps, and checklists.</p>
              </div>
              <Button size="sm" variant="secondary" onClick={onOpenNotesOverview}>
                <BookOpenText size={14} />
                Open notes
              </Button>
          </div>
          <div className="mt-3 h-px bg-[var(--vscode-border)]" aria-hidden="true" />
          <div className="pt-2">
              {recentNotes.map((note) => (
                <OverviewNoteRow key={note.id} note={note} onOpenNote={() => onOpenNote(note)} />
              ))}
              {notes.length === 0 ? (
                <div className="mt-4 rounded-[8px] border border-dashed border-[var(--vscode-border)] px-4 py-8 text-center text-[13px] text-[var(--vscode-foreground)]/68">
                  No notes yet. Capture setup docs and test credentials here.
                </div>
              ) : null}
          </div>
          {notes.length > 0 ? (
            <div className="pt-4">
              <Button variant="secondary" onClick={onOpenNotesOverview}>
                <BookOpenText size={14} />
                View all
              </Button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function CommandsOverviewPane({
  project,
  commands,
  commandSections,
  runs,
  onOpenCommand,
  onRunCommand,
  onStopCommand,
  onForceStopCommand,
  onRestartCommand,
  onEditCommand,
  onDeleteCommand,
  onKillPorts,
  onOpenLogs,
  onAddCommand,
}: {
  project: Project;
  commands: ProjectCommand[];
  commandSections: CommandSection[];
  runs: Record<number, RunState>;
  onOpenCommand: (command: ProjectCommand) => void;
  onRunCommand: (command: ProjectCommand) => void;
  onStopCommand: (command: ProjectCommand) => void;
  onForceStopCommand: (command: ProjectCommand) => void;
  onRestartCommand: (command: ProjectCommand) => void;
  onEditCommand: (command: ProjectCommand) => void;
  onDeleteCommand: (command: ProjectCommand) => void;
  onKillPorts: (command: ProjectCommand) => void;
  onOpenLogs: (commandId: number) => void;
  onAddCommand: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<CommandSortField>("runCount");
  const [sortDirection, setSortDirection] = useState<CommandSortDirection>("desc");
  const [sectionFilter, setSectionFilter] = useState("all");
  const sectionOptions = useMemo(
    () => ["all", ...commandSections.map((section) => section.section)],
    [commandSections],
  );
  const visibleSections = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLocaleLowerCase();

    return commandSections
      .filter(({ section }) => sectionFilter === "all" || section === sectionFilter)
      .map(({ section, commands }) => ({
        section,
        commands: commands
          .map((command) => ({ command, meta: buildCommandOverviewMeta(command) }))
          .filter(({ meta }) => (normalizedSearch ? meta.searchText.includes(normalizedSearch) : true))
          .sort((left, right) => compareCommandOverviewMeta(left.meta, right.meta, sortField, sortDirection))
          .map(({ command }) => command),
      }))
      .filter(({ commands }) => commands.length > 0);
  }, [commandSections, searchQuery, sectionFilter, sortDirection, sortField]);
  const visibleCommandCount = useMemo(
    () => visibleSections.reduce((total, section) => total + section.commands.length, 0),
    [visibleSections],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-[var(--vscode-editor)] px-6 py-5">
      <div className="mx-auto flex w-full max-w-[1320px] flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--vscode-border)] pb-3">
          <div>
            <h2 className="text-[20px] font-semibold text-foreground">{project.name} Commands</h2>
            <p className="text-[12px] text-[var(--vscode-foreground)]/64">Browse reusable commands grouped by section.</p>
          </div>
          <Button onClick={onAddCommand}>
            <Plus size={15} />
            Add command
          </Button>
        </div>

        <div className="py-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_220px_180px_220px]">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by name, section, or script"
                className="pl-9"
                aria-label="Search project commands"
              />
            </div>
            <Select value={sortField} onValueChange={(value) => setSortField(value as CommandSortField)}>
              <SelectTrigger aria-label="Sort commands by">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                {COMMAND_SORT_FIELD_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortDirection} onValueChange={(value) => setSortDirection(value as CommandSortDirection)}>
              <SelectTrigger aria-label="Sort direction">
                <SelectValue placeholder="Direction" />
              </SelectTrigger>
              <SelectContent>
                {COMMAND_SORT_DIRECTION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sectionFilter} onValueChange={setSectionFilter}>
              <SelectTrigger aria-label="Filter commands by section">
                <SelectValue placeholder="Filter section" />
              </SelectTrigger>
              <SelectContent>
                {sectionOptions.map((section) => (
                  <SelectItem key={section} value={section}>
                    {section === "all" ? "All sections" : section}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="mt-3 text-[11px] text-muted-foreground">
            {visibleCommandCount} / {commands.length} commands
          </div>
        </div>

        {visibleSections.map(({ section, commands }, index) => (
          <section key={section} className="py-5">
            {index > 0 ? <div className="mb-5 h-px bg-[var(--vscode-border)]" aria-hidden="true" /> : null}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/82">{section}</h3>
                <Badge variant="muted">{commands.length}</Badge>
              </div>
            </div>
            <div className="mt-3 h-px bg-[var(--vscode-border)]" aria-hidden="true" />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3 pt-4">
              {commands.map((command) => (
                <div key={command.id} className="space-y-2">
                  <CommandCard
                    command={command}
                    run={runs[command.id]}
                    onDelete={() => onDeleteCommand(command)}
                    onEdit={() => onEditCommand(command)}
                    onKillPorts={() => onKillPorts(command)}
                    onOpenDetail={() => onOpenCommand(command)}
                    onRestart={() => onRestartCommand(command)}
                    onRun={() => onRunCommand(command)}
                    onStop={() => onStopCommand(command)}
                    onForceStop={() => onForceStopCommand(command)}
                    onOpenLogs={() => onOpenLogs(command.id)}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
        {visibleCommandCount === 0 ? (
          <div className="mt-4 rounded-[8px] border border-dashed border-[var(--vscode-border)] px-4 py-10 text-center text-[13px] text-[var(--vscode-foreground)]/68">
            No commands match the current search or filter.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CommandDetailPane({
  project,
  command,
  run,
  onRunCommand,
  onStopCommand,
  onForceStopCommand,
  onRestartCommand,
  onEditCommand,
  onDeleteCommand,
  onKillPorts,
  onOpenLogs,
}: {
  project: Project;
  command: ProjectCommand;
  run?: RunState;
  onRunCommand: (command: ProjectCommand) => void;
  onStopCommand: (command: ProjectCommand) => void;
  onForceStopCommand: (command: ProjectCommand) => void;
  onRestartCommand: (command: ProjectCommand) => void;
  onEditCommand: (command: ProjectCommand) => void;
  onDeleteCommand: (command: ProjectCommand) => void;
  onKillPorts: (command: ProjectCommand) => void;
  onOpenLogs: (commandId: number) => void;
}) {
  const normalizedScript = normalizeCommandScript(command.script);
  const ports = commandPorts(command);
  const statusVariant = run?.status === "running" ? "success" : run?.status === "failed" ? "danger" : "muted";
  const lineCount = normalizedScript.split(/\r?\n/).length;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-[var(--vscode-editor)] px-6 py-5">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col">
        <section className="py-1">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3 py-4">
              <EntityAvatar name={command.name} path={command.avatar_path} />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[22px] font-semibold text-foreground">{command.name}</h2>
                  <Badge variant={statusVariant}>{run?.status ?? "ready"}</Badge>
                  <Badge variant="muted">{command.section}</Badge>
                  <Badge variant="muted">{runtimeModeLabel(command.runtime_mode)}</Badge>
                  <Badge variant="muted">{formatRunCountLabel(command.run_count)}</Badge>
                  <Badge variant="muted">{lineCount} lines</Badge>
                </div>
                <p className="mt-1 text-[12px] text-[var(--vscode-foreground)]/68">{project.name}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 py-4">
              {run?.status === "running" ? (
                <>
                  <Button variant="outline" onClick={() => onStopCommand(command)}>
                    <Square size={14} />
                    Stop
                  </Button>
                  <Button variant="outline" onClick={() => onForceStopCommand(command)}>
                    <X size={14} />
                    Force stop
                  </Button>
                  <Button variant="secondary" onClick={() => onRestartCommand(command)}>
                    <RotateCcw size={14} />
                    Restart
                  </Button>
                </>
              ) : (
                <Button onClick={() => onRunCommand(command)}>
                  <Play size={14} />
                  Run
                </Button>
              )}
              <Button variant="secondary" onClick={() => onOpenLogs(command.id)}>
                <TerminalSquare size={14} />
                Terminal
              </Button>
              <Button variant="secondary" onClick={() => onKillPorts(command)}>
                <PowerOff size={14} />
                Kill ports
              </Button>
              <Button variant="secondary" onClick={() => onEditCommand(command)}>
                <Pencil size={14} />
                Edit
              </Button>
              <Button variant="danger" onClick={() => onDeleteCommand(command)}>
                <Trash2 size={14} className="text-[var(--vscode-danger)]" />
                Delete
              </Button>
            </div>
          </div>

          <div className="h-px bg-[var(--vscode-border)]" aria-hidden="true" />

          <div className="grid sm:grid-cols-3">
            <div className="border-r border-[var(--vscode-border)] px-4 py-3">
              <div className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/50">Section</div>
              <div className="mt-1 text-[12px] text-foreground">{command.section}</div>
            </div>
            <div className="border-r border-[var(--vscode-border)] px-4 py-3">
              <div className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/50">Mode</div>
              <div className="mt-1 text-[12px] text-foreground">{runtimeModeLabel(command.runtime_mode)}</div>
            </div>
            <div className="px-4 py-3">
              <div className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/50">Ports</div>
              <div className="mt-1 text-[12px] text-foreground">{ports.length > 0 ? ports.map((port) => `:${port}`).join(", ") : "No tracked ports"}</div>
            </div>
          </div>
        </section>

        <div className="my-5 h-px bg-[var(--vscode-border)]" aria-hidden="true" />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_300px]">
          <section className="py-1">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/50">Script</div>
                <h3 className="mt-1 text-[14px] font-semibold text-foreground">Command source</h3>
              </div>
              <Badge variant="muted">{lineCount} lines</Badge>
            </div>
            <div className="mb-4 h-px bg-[var(--vscode-border)]" aria-hidden="true" />
            <pre className="overflow-x-auto rounded-[6px] border border-[var(--vscode-border)] bg-[var(--script-preview-bg)] p-3.5 font-mono text-[11.5px] leading-6 text-[var(--script-preview-color)]">
              {normalizedScript}
            </pre>
          </section>
          <div className="space-y-5">
            <section className="py-1">
              <div className="mb-3">
                <div className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/50">Metadata</div>
                <h3 className="mt-1 text-[14px] font-semibold text-foreground">Runtime details</h3>
              </div>
              <div className="mb-4 h-px bg-[var(--vscode-border)]" aria-hidden="true" />
              <div className="space-y-2 text-[12px] text-[var(--vscode-foreground)]/74">
                <div className="flex items-center justify-between gap-3"><span>Section</span><span className="text-foreground">{command.section}</span></div>
                <div className="flex items-center justify-between gap-3"><span>Run count</span><span className="text-foreground">{formatRunCountLabel(command.run_count)}</span></div>
                <div className="flex items-center justify-between gap-3"><span>Mode</span><span className="text-foreground">{runtimeModeLabel(command.runtime_mode)}</span></div>
                <div className="flex items-center justify-between gap-3"><span>External terminal</span><span className="text-foreground">{command.run_in_external_terminal ? "Yes" : "No"}</span></div>
                <div className="flex items-center justify-between gap-3"><span>Created</span><span className="text-foreground">{formatDateTime(command.created_at)}</span></div>
                <div className="flex items-center justify-between gap-3"><span>Updated</span><span className="text-foreground">{formatDateTime(command.updated_at)}</span></div>
              </div>
            </section>
            <section className="py-1">
              <div className="mb-3">
                <div className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/50">Ports</div>
                <h3 className="mt-1 text-[14px] font-semibold text-foreground">Tracked listeners</h3>
              </div>
              <div className="mb-4 h-px bg-[var(--vscode-border)]" aria-hidden="true" />
              <div className="flex flex-wrap gap-2">
                {ports.length > 0 ? ports.map((port) => <Badge key={port} variant="muted">:{port}</Badge>) : <span className="text-[12px] text-[var(--vscode-foreground)]/64">No tracked ports</span>}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function NoteDetailPane({
  project,
  note,
  isVisible,
  onDelete,
  onEdit,
  onTogglePinned,
  onToggleVisibility,
}: {
  project: Project;
  note: ProjectNote;
  isVisible: boolean;
  onDelete: (noteId: string) => void;
  onEdit: (noteId: string, title: string, content: string) => void;
  onTogglePinned: (noteId: string) => void;
  onToggleVisibility: () => void;
}) {
  const title = noteTitle(note);
  const createdTooltip = `Created ${formatDateTime(note.createdAt)}`;
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editDraft, setEditDraft] = useState({ title: note.title, content: note.content });

  useEffect(() => {
    setEditDraft({ title: note.title, content: note.content });
  }, [note.content, note.id, note.title]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-[var(--vscode-editor)] px-6 py-5">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col">
        <section className="py-1">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="py-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[22px] font-semibold text-foreground">{title}</h2>
                {note.pinned ? <Badge variant="muted">Pinned</Badge> : null}
                <Badge variant="muted">{project.name}</Badge>
                {!isVisible ? <Badge variant="muted">Hidden</Badge> : null}
              </div>
              <p className="mt-1 text-[12px] text-[var(--vscode-foreground)]/68">
                Created {formatDateTime(note.createdAt)}
              </p>
              <p className="mt-1 text-[12px] text-[var(--vscode-foreground)]/68">
                Updated {formatDateTime(note.updatedAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 py-4">
              <Button variant="secondary" onClick={() => onTogglePinned(note.id)}>
                {note.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                {note.pinned ? "Unpin" : "Pin"}
              </Button>
              <Button variant="secondary" onClick={() => setIsEditDialogOpen(true)}>
                <Pencil size={14} />
                Edit
              </Button>
              <Button variant="secondary" onClick={onToggleVisibility}>
                {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                {isVisible ? "Hide content" : "Show content"}
              </Button>
              <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(note.content)}>
                <CopyPlus size={14} />
                Copy content
              </Button>
              <Button variant="danger" onClick={() => onDelete(note.id)}>
                <Trash2 size={14} className="text-[var(--vscode-danger)]" />
                Delete
              </Button>
            </div>
          </div>
        </section>

        <div className="my-5 h-px bg-[var(--vscode-border)]" aria-hidden="true" />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <section className="py-1">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/50">Source</div>
                <h3 className="mt-1 text-[14px] font-semibold text-foreground">Original text</h3>
              </div>
            </div>
            <div className="mb-4 h-px bg-[var(--vscode-border)]" aria-hidden="true" />
            <div className="min-h-[420px] overflow-auto rounded-[6px] border border-[var(--vscode-border)] bg-[var(--script-preview-bg)] p-4 font-mono text-[11.5px] leading-6 text-[var(--script-preview-color)] whitespace-pre-wrap">
              {note.content || "_Empty note_"}
            </div>
          </section>

          <section className="py-1">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/50">Content</div>
                <h3 className="mt-1 text-[14px] font-semibold text-foreground">Rendered markdown</h3>
              </div>
              {!isVisible ? <Badge variant="muted">Hidden</Badge> : null}
            </div>
            <div className="mb-4 h-px bg-[var(--vscode-border)]" aria-hidden="true" />
            <Tooltip content={createdTooltip}>
              <div>
                {isVisible ? (
                  <MarkdownPreview content={note.content || "_Empty note_"} className="min-h-[420px] overflow-y-auto rounded-[6px] bg-[var(--vscode-editor)] text-[12px]" />
                ) : (
                  <div className="flex min-h-[420px] items-center justify-center rounded-[6px] border border-dashed border-[var(--vscode-border)] text-[13px] text-[var(--vscode-foreground)]/64">
                    This note is currently hidden in the project workspace.
                  </div>
                )}
              </div>
            </Tooltip>
          </section>
        </div>

        <ProjectNoteDialog
          mode="edit"
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          projectName={project.name}
          value={editDraft}
          onValueChange={(field, value) => setEditDraft((current) => ({ ...current, [field]: value }))}
          onSubmit={(event) => {
            event.preventDefault();
            if (!editDraft.title.trim() || !editDraft.content.trim()) {
              return;
            }
            onEdit(note.id, editDraft.title, editDraft.content);
            setIsEditDialogOpen(false);
          }}
          isSaving={false}
        />
      </div>
    </div>
  );
}

type VSCodeShellProps = {
  projects: Project[];
  selectedProject: Project | null;
  selectedProjectId: number | null;
  commands: ProjectCommand[];
  commandsByProjectId: Record<number, ProjectCommand[]>;
  flowsByProjectId: Record<number, ProjectFlow[]>;
  flowRuns: Record<number, FlowRunState>;
  onRunFlow: (flow: ProjectFlow) => void;
  onStopFlow: (flowId: number) => void;
  onDeleteFlow: (flow: ProjectFlow) => void;
  commandSectionsByProjectId: Record<number, CommandSection[]>;
  settingsProps: SettingsPageProps;
  updateStatus: UpdateStatus;
  updateVersion: string | null;
  onOpenUpdate: () => void;
  sortedProjectNotesByProjectId: Record<number, ProjectNote[]>;
  noteVisibility: Record<string, boolean>;
  newProjectNotesByProjectId: Record<number, { title: string; content: string }>;
  onNewProjectNoteChange: (projectId: number, field: "title" | "content", value: string) => void;
  onAddProjectNote: (projectId: number) => void;
  onEditProjectNote: (projectId: number, noteId: string, title: string, content: string) => void;
  onTogglePinnedProjectNote: (projectId: number, noteId: string) => void;
  onToggleProjectNoteVisibility: (projectId: number, noteId: string) => void;
  onDeleteProjectNote: (projectId: number, noteId: string) => void;
  isSavingNotes: boolean;
  runs: Record<number, RunState>;
  terminalContentByCommandId: Record<number, string>;
  openLogCommandIds: number[];
  activeLogCommandId: number | null;
  onActiveLogCommandChange: (commandId: number) => void;
  onClearLogs: (commandId: number) => void;
  onCloseLogTab: (commandId: number) => void;
  onTerminalInput: (commandId: number, data: string) => void;
  onTerminalResize: (commandId: number, cols: number, rows: number) => void;
  terminalFontFamily: string;
  terminalFontSize: string;
  theme: "light" | "dark";
  onAddProject: () => void;
  onImportProject: () => void;
  onSelectProject: (projectId: number) => void;
  onOpenExplorer: (project: Project) => void;
  onOpenTerminal: (project: Project) => void;
  onShareProject: (project: Project) => void;
  onEditProject: (project: Project) => void;
  onAddCommand: (
    projectId: number,
    preset?: {
      interactive_terminal_kind?: InteractiveTerminalKind | null;
      runtime_mode?: "internal_interactive" | "internal_headless" | "external_terminal" | null;
    } | null,
  ) => void;
  interactiveTerminalOptions: InteractiveTerminalOption[];
  onRequestCloseAllLogTabs: (commandIds: number[]) => void;
  onOpenAdHocInteractiveTerminal: (project: Project, terminalKind: InteractiveTerminalKind) => void;
  onEditCommand: (command: ProjectCommand) => void;
  onDeleteCommand: (command: ProjectCommand) => void;
  onRunCommand: (command: ProjectCommand) => void;
  onStopCommand: (command: ProjectCommand) => void;
  onForceStopCommand: (command: ProjectCommand) => void;
  onRestartCommand: (command: ProjectCommand) => void;
  onKillPorts: (command: ProjectCommand) => void;
  onOpenLogs: (commandId: number) => void;
};

export const VSCodeShell = forwardRef<VSCodeShellHandle, VSCodeShellProps>(function VSCodeShell({
  projects,
  selectedProject,
  selectedProjectId,
  commands,
  commandsByProjectId,
  flowsByProjectId,
  flowRuns,
  onRunFlow,
  onStopFlow,
  onDeleteFlow,
  commandSectionsByProjectId,
  settingsProps,
  updateStatus,
  updateVersion,
  onOpenUpdate,
  sortedProjectNotesByProjectId,
  noteVisibility,
  newProjectNotesByProjectId,
  onNewProjectNoteChange,
  onAddProjectNote,
  onEditProjectNote,
  onTogglePinnedProjectNote,
  onToggleProjectNoteVisibility,
  onDeleteProjectNote,
  isSavingNotes,
  runs,
  terminalContentByCommandId,
  openLogCommandIds,
  activeLogCommandId,
  onActiveLogCommandChange,
  onClearLogs,
  onCloseLogTab,
  onTerminalInput,
  onTerminalResize,
  terminalFontFamily,
  terminalFontSize,
  theme,
  onAddProject,
  onImportProject,
  onSelectProject,
  onOpenExplorer,
  onOpenTerminal,
  onShareProject,
  onEditProject,
  onAddCommand,
  interactiveTerminalOptions,
  onRequestCloseAllLogTabs,
  onOpenAdHocInteractiveTerminal,
  onEditCommand,
  onDeleteCommand,
  onRunCommand,
  onStopCommand,
  onForceStopCommand,
  onRestartCommand,
  onKillPorts,
  onOpenLogs,
}, ref) {
  const queryClient = useQueryClient();
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>("appearance");
  const [activeSidebarView, setActiveSidebarView] = useState<SidebarView>(() => {
    if (typeof window === "undefined") {
      return "explorer";
    }
    const saved = localStorage.getItem(SIDEBAR_VIEW_KEY);
    return saved === "flows" || saved === "notes" || saved === "terminal" || saved === "settings" ? saved : "explorer";
  });
  const [tabs, setTabs] = useState<EditorTab[]>(() => [welcomeTab()]);
  const [activeTabId, setActiveTabId] = useState("welcome");
  const [flowDialogProject, setFlowDialogProject] = useState<Project | null>(null);
  const [isCreatingFlow, setIsCreatingFlow] = useState(false);
  const [flowCreationError, setFlowCreationError] = useState<string | null>(null);
  const [commandsExpanded, setCommandsExpanded] = useState(true);
  const [notesExpanded, setNotesExpanded] = useState(true);
  const [flowsExpanded, setFlowsExpanded] = useState(true);
  const [sidebarLayout, setSidebarLayout] = useState<{ sidebar: number; editor: number }>(() => readSidebarLayout());
  const runningCount = Object.values(runs).filter((run) => run.status === "running").length;
  const activeTabProjectId = getProjectIdFromTab(tabs.find((tab) => tab.id === activeTabId) ?? welcomeTab());
  const activeContextProject = findProjectById(projects, activeTabProjectId ?? selectedProjectId ?? undefined) ?? selectedProject;
  const selectedProjectCommands = activeContextProject ? commandsByProjectId[activeContextProject.id] ?? [] : [];
  const selectedProjectNotes = activeContextProject ? sortedProjectNotesByProjectId[activeContextProject.id] ?? [] : [];
  const selectedProjectFlows = activeContextProject ? flowsByProjectId[activeContextProject.id] ?? [] : [];

  useEffect(() => {
    localStorage.setItem(SIDEBAR_VIEW_KEY, activeSidebarView);
  }, [activeSidebarView]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_LAYOUT_KEY, JSON.stringify(sidebarLayout));
  }, [sidebarLayout]);

  useEffect(() => {
    if (!selectedProject) {
      setTabs((current) => {
        const settingsOnly = current.filter((tab) => tab.kind === "settings");
        return settingsOnly.length > 0 ? settingsOnly : [welcomeTab()];
      });
      setActiveTabId("welcome");
      return;
    }

    const overview = projectOverviewTab(selectedProject);
    setTabs((current) => {
      if (current.some((tab) => tab.id === overview.id)) {
        return current;
      }
      if (current.length === 1 && current[0]?.kind === "welcome") {
        return [overview];
      }
      return [...current.filter((tab) => tab.id !== "welcome"), overview];
    });
    setActiveTabId((current) => (current === "welcome" ? overview.id : current));
  }, [selectedProject?.id]);

  useEffect(() => {
    setTabs((current) =>
      current.filter((tab) => {
        if (tab.kind === "welcome" || tab.kind === "settings") {
          return true;
        }
        const project = findProjectById(projects, "projectId" in tab ? tab.projectId : undefined);
        if (!project) {
          return false;
        }
        if (tab.kind === "command") {
          return Boolean(findCommandById(commandsByProjectId[tab.projectId] ?? [], tab.commandId));
        }
        if (tab.kind === "note") {
          return Boolean(findNoteById(sortedProjectNotesByProjectId[tab.projectId] ?? [], tab.noteId));
        }
        if (tab.kind === "flow") {
          return Boolean((flowsByProjectId[tab.projectId] ?? []).some((flow) => flow.id === tab.flowId));
        }
        return true;
      }),
    );
  }, [commandsByProjectId, flowsByProjectId, projects, sortedProjectNotesByProjectId]);

  useEffect(() => {
    setTabs((current) => current.map((tab) => {
      if (tab.kind !== "flow") return tab;
      const flow = (flowsByProjectId[tab.projectId] ?? []).find((item) => item.id === tab.flowId);
      return flow && flow.name !== tab.title ? { ...tab, title: flow.name } : tab;
    }));
  }, [flowsByProjectId]);

  useEffect(() => {
    setActiveTabId((current) => {
      if (tabs.some((tab) => tab.id === current)) {
        return current;
      }
      return tabs[0]?.id ?? "welcome";
    });
  }, [tabs]);

  useEffect(() => {
    if (!activeTabProjectId || selectedProjectId === activeTabProjectId) {
      return;
    }
    onSelectProject(activeTabProjectId);
  }, [activeTabProjectId, onSelectProject, selectedProjectId]);

  function openTab(tab: EditorTab) {
    setTabs((current) => {
      const withoutTransient = current.filter((entry) => {
        if (entry.id === "welcome") {
          return false;
        }
        if (tab.kind !== "settings" && entry.kind === "settings") {
          return false;
        }
        return true;
      });

      if (withoutTransient.some((entry) => entry.id === tab.id)) {
        return withoutTransient;
      }
      return [...withoutTransient, tab];
    });
    setActiveTabId(tab.id);
  }

  function closeTab(tabId: string) {
    let nextActiveId = activeTabId;
    setTabs((current) => {
      nextActiveId = resolveNextActiveTabId(current, tabId, activeTabId);
      const next = current.filter((tab) => tab.id !== tabId);
      return next.length > 0 ? next : [welcomeTab()];
    });
    setActiveTabId(nextActiveId);
  }

  function handleSelectProject(projectId: number) {
    setActiveSidebarView("explorer");
    onSelectProject(projectId);
    const project = findProjectById(projects, projectId);
    if (project) {
      openTab(projectOverviewTab(project));
    }
  }

  function handleOpenSettings() {
    setActiveSidebarView("settings");
    openTab(settingsTab());
  }

  function handleOpenCommandTab(command: ProjectCommand) {
    openTab({
      id: `command:${command.id}`,
      kind: "command",
      title: command.name,
      projectId: command.project_id,
      commandId: command.id,
    });
    setActiveSidebarView("explorer");
  }

  function handleOpenFlowTab(project: Project, flow: ProjectFlow) {
    openTab(flowTab(project, flow));
    setActiveSidebarView("flows");
  }

  function handleOpenFlowsOverviewForProject(project: Project) {
    openTab(flowsOverviewTab(project));
    setActiveSidebarView("flows");
  }

  function handleOpenFlowsOverview() {
    if (activeContextProject) {
      handleOpenFlowsOverviewForProject(activeContextProject);
    }
  }

  function handleCreateFlow(project: Project) {
    setFlowCreationError(null);
    setFlowDialogProject(project);
  }

  async function submitFlow(project: Project, name: string) {
    setIsCreatingFlow(true);
    setFlowCreationError(null);
    try {
      const flow = await api.createFlow(project.id, name);
      await queryClient.invalidateQueries({ queryKey: ["flows", project.id] });
      setFlowDialogProject(null);
      handleOpenFlowTab(project, flow);
    } catch (error) {
      setFlowCreationError(error instanceof Error ? error.message : "Unable to create flow.");
    } finally {
      setIsCreatingFlow(false);
    }
  }

  function handleOpenNotesOverview() {
    if (!activeContextProject) return;
    handleOpenNotesOverviewForProject(activeContextProject);
    setActiveSidebarView("notes");
  }

  function handleOpenCommandsOverview() {
    if (!activeContextProject) return;
    handleOpenCommandsOverviewForProject(activeContextProject);
    setActiveSidebarView("explorer");
  }

  function handleOpenProjectOverview() {
    if (!activeContextProject) return;
    handleOpenProjectOverviewForProject(activeContextProject);
    setActiveSidebarView("explorer");
  }

  function handleOpenProjectOverviewForProject(project: Project) {
    openTab(projectOverviewTab(project));
  }

  function handleOpenCommandsOverviewForProject(project: Project) {
    openTab(commandsOverviewTab(project));
  }

  function handleOpenNotesOverviewForProject(project: Project) {
    openTab(notesOverviewTab(project));
  }

  function handleOpenNoteTab(project: Project, note: ProjectNote) {
    openTab({
      id: `note:${note.id}`,
      kind: "note",
      title: noteTitle(note),
      projectId: project.id,
      noteId: note.id,
    });
    setActiveSidebarView("notes");
  }

  function handleOpenLogs(commandId: number) {
    setActiveSidebarView("terminal");
    onOpenLogs(commandId);
  }

  useImperativeHandle(
    ref,
    () => ({
      openProject(projectId: number) {
        handleSelectProject(projectId);
      },
      openCommand(projectId: number, commandId: number) {
        const command = findCommandById(commandsByProjectId[projectId] ?? [], commandId);
        if (!command) {
          return;
        }
        handleOpenCommandTab(command);
      },
      openNote(projectId: number, noteId: string) {
        const project = findProjectById(projects, projectId);
        const note = findNoteById(sortedProjectNotesByProjectId[projectId] ?? [], noteId);
        if (!project || !note) {
          return;
        }
        handleOpenNoteTab(project, note);
      },
      openFlow(projectId: number, flowId: number) {
        const project = findProjectById(projects, projectId);
        const flow = (flowsByProjectId[projectId] ?? []).find((item) => item.id === flowId);
        if (project && flow) handleOpenFlowTab(project, flow);
      },
    }),
    [commandsByProjectId, flowsByProjectId, projects, sortedProjectNotesByProjectId],
  );

  function handleSwitchPrimarySidebar(view: Exclude<SidebarView, "settings">) {
    if (activeTab.kind === "settings") {
      if (view === "notes" && activeContextProject) {
        handleOpenNotesOverviewForProject(activeContextProject);
      } else if (view === "flows" && activeContextProject) {
        handleOpenFlowsOverviewForProject(activeContextProject);
      } else if (view === "explorer" && activeContextProject) {
        handleOpenProjectOverviewForProject(activeContextProject);
      } else {
        closeTab("settings");
      }
    }

    setActiveSidebarView(view);
  }

  function getProjectMenuItems(project: Project) {
    return [
      {
        label: "Open overview",
        icon: <LayoutGrid size={13} />,
        onSelect: () => handleOpenProjectOverviewForProject(project),
      },
      {
        label: "Reveal in Explorer",
        icon: <FolderOpen size={13} />,
        onSelect: () => onOpenExplorer(project),
      },
      {
        label: "Open terminal",
        icon: <TerminalSquare size={13} />,
        onSelect: () => onOpenTerminal(project),
      },
      {
        label: "Export project",
        icon: <FileUp size={13} />,
        onSelect: () => onShareProject(project),
      },
      {
        label: "Edit project",
        icon: <Pencil size={13} />,
        onSelect: () => onEditProject(project),
      },
    ];
  }

  function getCommandsMenuItems(project: Project) {
    return [
      {
        label: "Open commands view",
        icon: <LayoutGrid size={13} />,
        onSelect: () => handleOpenCommandsOverviewForProject(project),
      },
      {
        label: "Add command",
        icon: <CopyPlus size={13} />,
        onSelect: () => onAddCommand(project.id),
      },
    ];
  }

  function getCommandMenuItems(command: ProjectCommand) {
    const run = runs[command.id];
    const isRunning = run?.status === "running";

    return [
      {
        label: "Open command",
        icon: <LayoutGrid size={13} />,
        onSelect: () => handleOpenCommandTab(command),
      },
      {
        label: "Run command",
        icon: <Play size={13} />,
        onSelect: () => onRunCommand(command),
        disabled: isRunning,
      },
      {
        label: "Stop command",
        icon: <Square size={13} />,
        onSelect: () => onStopCommand(command),
        disabled: !isRunning,
      },
      {
        label: "Restart command",
        icon: <RotateCcw size={13} />,
        onSelect: () => onRestartCommand(command),
      },
      {
        label: "Open logs",
        icon: <TerminalSquare size={13} />,
        onSelect: () => handleOpenLogs(command.id),
      },
      {
        label: "Edit command",
        icon: <FilePenLine size={13} />,
        onSelect: () => onEditCommand(command),
      },
      {
        label: "Delete command",
        icon: <Trash2 size={13} className="text-[var(--vscode-danger)]" />,
        onSelect: () => onDeleteCommand(command),
        tone: "danger" as const,
      },
    ];
  }

  function getNotesMenuItems(project: Project) {
    return [
      {
        label: "Open notes view",
        icon: <LayoutGrid size={13} />,
        onSelect: () => handleOpenNotesOverviewForProject(project),
      },
      {
        label: "Add note",
        icon: <Plus size={13} />,
        onSelect: () => onAddProjectNote(project.id),
      },
    ];
  }

  function getNoteMenuItems(project: Project, note: ProjectNote) {
    const isVisible = noteVisibility[projectNoteVisibilityKey(project.id, note.id)] ?? true;

    return [
      {
        label: "Open note",
        icon: <BookOpenText size={13} />,
        onSelect: () => handleOpenNoteTab(project, note),
      },
      {
        label: note.pinned ? "Unpin note" : "Pin note",
        icon: <Pin size={13} />,
        onSelect: () => onTogglePinnedProjectNote(project.id, note.id),
      },
      {
        label: isVisible ? "Hide note" : "Show note",
        icon: isVisible ? <EyeOff size={13} /> : <Eye size={13} />,
        onSelect: () => onToggleProjectNoteVisibility(project.id, note.id),
      },
      {
        label: "Delete note",
        icon: <Trash2 size={13} className="text-[var(--vscode-danger)]" />,
        onSelect: () => onDeleteProjectNote(project.id, note.id),
        tone: "danger" as const,
      },
    ];
  }

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? welcomeTab();

  useEffect(() => {
    if (activeTab.kind === "settings") {
      setActiveSidebarView("settings");
      return;
    }

    if (activeTab.kind === "note" || activeTab.kind === "notes-overview") {
      setActiveSidebarView("notes");
      return;
    }

    if (activeTab.kind === "flow" || activeTab.kind === "flows-overview") {
      setActiveSidebarView("flows");
      return;
    }

    setActiveSidebarView("explorer");
  }, [activeTab.kind]);

  const editorBody = (() => {
    if (activeTab.kind === "welcome") {
      return <WelcomeEditor onAddProject={onAddProject} onImportProject={onImportProject} />;
    }

    if (activeTab.kind === "settings") {
      return (
        <div className="min-h-0 flex-1 overflow-hidden bg-[var(--vscode-editor)]">
          <SettingsPage
            {...settingsProps}
            activeSection={activeSettingsSection}
          />
        </div>
      );
    }

    const tabProject = findProjectById(projects, activeTab.projectId);
    if (!tabProject) {
      return <WelcomeEditor onAddProject={onAddProject} onImportProject={onImportProject} />;
    }

    if (activeTab.kind === "project-overview") {
      const tabProjectCommands = commandsByProjectId[tabProject.id] ?? [];
      const tabProjectNotes = sortedProjectNotesByProjectId[tabProject.id] ?? [];
      return (
        <ProjectOverviewPane
          project={tabProject}
          commands={tabProjectCommands}
          notes={tabProjectNotes}
          runs={runs}
          onOpenCommand={handleOpenCommandTab}
          onOpenNote={(note) => handleOpenNoteTab(tabProject, note)}
          onOpenCommandsOverview={() => {
            handleOpenCommandsOverviewForProject(tabProject);
            setActiveSidebarView("explorer");
          }}
          onOpenNotesOverview={() => {
            handleOpenNotesOverviewForProject(tabProject);
            setActiveSidebarView("notes");
          }}
          onRunCommand={onRunCommand}
          onStopCommand={onStopCommand}
          onAddCommand={() => onAddCommand(tabProject.id)}
          onOpenExplorer={() => onOpenExplorer(tabProject)}
          onOpenTerminal={() => onOpenTerminal(tabProject)}
          onShareProject={() => onShareProject(tabProject)}
          onEditProject={() => onEditProject(tabProject)}
        />
      );
    }

    if (activeTab.kind === "commands-overview") {
      const tabProjectCommands = commandsByProjectId[tabProject.id] ?? [];
      const tabProjectCommandSections = commandSectionsByProjectId[tabProject.id] ?? [];
      return (
        <CommandsOverviewPane
          project={tabProject}
          commands={tabProjectCommands}
          commandSections={tabProjectCommandSections}
          runs={runs}
          onOpenCommand={handleOpenCommandTab}
          onRunCommand={onRunCommand}
          onStopCommand={onStopCommand}
          onForceStopCommand={onForceStopCommand}
          onRestartCommand={onRestartCommand}
          onEditCommand={onEditCommand}
          onDeleteCommand={onDeleteCommand}
          onKillPorts={onKillPorts}
          onOpenLogs={handleOpenLogs}
          onAddCommand={() => onAddCommand(tabProject.id)}
        />
      );
    }

    if (activeTab.kind === "notes-overview") {
      const tabProjectNotes = sortedProjectNotesByProjectId[tabProject.id] ?? [];
      return (
        <div className="min-h-0 flex-1 overflow-hidden bg-[var(--vscode-editor)] p-6">
          <div className="mx-auto flex h-full max-w-[1220px] min-h-0 flex-col">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[20px] font-semibold text-foreground">{tabProject.name} Notes</h2>
                <p className="text-[12px] text-[var(--vscode-foreground)]/64">Markdown notes stored with this project.</p>
              </div>
            </div>
            <div className="mb-5 h-px bg-[var(--vscode-border)]" aria-hidden="true" />
            <ProjectDetailNotes
              selectedProject={tabProject}
              sortedProjectNotes={tabProjectNotes}
              noteVisibility={noteVisibility}
              newProjectNote={newProjectNotesByProjectId[tabProject.id] ?? { title: "", content: "" }}
              onNewProjectNoteChange={(field, value) => onNewProjectNoteChange(tabProject.id, field, value)}
              onAddProjectNote={() => onAddProjectNote(tabProject.id)}
              onEditProjectNote={(noteId, title, content) => onEditProjectNote(tabProject.id, noteId, title, content)}
              onTogglePinnedProjectNote={(noteId) => onTogglePinnedProjectNote(tabProject.id, noteId)}
              onToggleProjectNoteVisibility={(noteId) => onToggleProjectNoteVisibility(tabProject.id, noteId)}
              onDeleteProjectNote={(noteId) => onDeleteProjectNote(tabProject.id, noteId)}
              onOpenProjectNote={(noteId) => {
                const note = findNoteById(tabProjectNotes, noteId);
                if (note) {
                  handleOpenNoteTab(tabProject, note);
                }
              }}
              isSavingNotes={isSavingNotes}
            />
          </div>
        </div>
      );
    }

    if (activeTab.kind === "flows-overview") {
      return <FlowsOverviewPane
        project={tabProject}
        flows={flowsByProjectId[tabProject.id] ?? []}
        flowRuns={flowRuns}
        onCreate={() => handleCreateFlow(tabProject)}
        onOpen={(flow) => handleOpenFlowTab(tabProject, flow)}
        onRun={onRunFlow}
        onStop={(flow) => onStopFlow(flow.id)}
        onDelete={onDeleteFlow}
      />;
    }

    if (activeTab.kind === "flow") {
      const flow = (flowsByProjectId[tabProject.id] ?? []).find((item) => item.id === activeTab.flowId);
      if (!flow) return <WelcomeEditor onAddProject={onAddProject} onImportProject={onImportProject} />;
      return <FlowLauncher
        flow={flow}
        commands={commandsByProjectId[tabProject.id] ?? []}
        runs={runs}
        flowRun={flowRuns[flow.id]}
        onRunFlow={onRunFlow}
        onStopFlow={onStopFlow}
        onOpenLogs={handleOpenLogs}
        onDeleted={() => onDeleteFlow(flow)}
      />;
    }

    if (activeTab.kind === "command") {
      const command = findCommandById(commandsByProjectId[tabProject.id] ?? [], activeTab.commandId);
      if (!command) {
        return <WelcomeEditor onAddProject={onAddProject} onImportProject={onImportProject} />;
      }
      return (
        <CommandDetailPane
          project={tabProject}
          command={command}
          run={runs[command.id]}
          onRunCommand={onRunCommand}
          onStopCommand={onStopCommand}
          onForceStopCommand={onForceStopCommand}
          onRestartCommand={onRestartCommand}
          onEditCommand={onEditCommand}
          onDeleteCommand={onDeleteCommand}
          onKillPorts={onKillPorts}
          onOpenLogs={handleOpenLogs}
        />
      );
    }

    if (activeTab.kind === "note") {
      const note = findNoteById(sortedProjectNotesByProjectId[tabProject.id] ?? [], activeTab.noteId);
      if (!note) {
        return <WelcomeEditor onAddProject={onAddProject} onImportProject={onImportProject} />;
      }
      return (
        <NoteDetailPane
          project={tabProject}
          note={note}
          isVisible={noteVisibility[projectNoteVisibilityKey(tabProject.id, note.id)] ?? true}
          onDelete={(noteId) => onDeleteProjectNote(tabProject.id, noteId)}
          onEdit={(noteId, title, content) => onEditProjectNote(tabProject.id, noteId, title, content)}
          onTogglePinned={(noteId) => onTogglePinnedProjectNote(tabProject.id, noteId)}
          onToggleVisibility={() => onToggleProjectNoteVisibility(tabProject.id, note.id)}
        />
      );
    }

    return <WelcomeEditor onAddProject={onAddProject} onImportProject={onImportProject} />;
  })();

  const sidebarContent = (() => {
    if (activeSidebarView === "settings") {
      return (
        <div className="px-2 py-3">
          <div className="mb-2 px-2 text-[11px] uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/46">Preferences</div>
          <div className="space-y-1">
            {(
              [
                { id: "appearance", label: "Appearance", icon: <LayoutGrid size={14} /> },
                { id: "terminal", label: "Terminal", icon: <TerminalSquare size={14} /> },
                { id: "system", label: "System", icon: <Settings2 size={14} /> },
              ] as const
            ).map((item) => (
              <TreeItem
                key={item.id}
                title={item.label}
                icon={item.icon}
                active={activeTab.kind === "settings" && activeSettingsSection === item.id}
                onClick={() => {
                  setActiveSettingsSection(item.id);
                  handleOpenSettings();
                }}
              />
            ))}
          </div>
        </div>
      );
    }

    if (activeSidebarView === "terminal") {
      const openCommands = commands.filter(
        (command) => openLogCommandIds.includes(command.id) || runs[command.id] || terminalContentByCommandId[command.id],
      );
      return (
        <div className="px-2 py-3">
          <div className="mb-2 px-2 text-[11px] uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/46">Terminal sessions</div>
          <div className="mx-2 mb-3 h-px bg-[var(--vscode-border)]" aria-hidden="true" />
          {openCommands.length > 0 ? (
            <div className="space-y-1">
              {openCommands.map((command) => (
                <TreeItem
                  key={command.id}
                  title={command.name}
                  icon={<TerminalSquare size={14} />}
                  active={activeLogCommandId === command.id}
                  trailing={runs[command.id]?.status === "running" ? "running" : undefined}
                  onClick={() => {
                    onOpenLogs(command.id);
                    onActiveLogCommandChange(command.id);
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="px-2 py-2 text-[12px] text-[var(--vscode-foreground)]/62">
              Run a command to populate the integrated terminal panel.
            </div>
          )}
        </div>
      );
    }

    if (activeSidebarView === "notes") {
      return (
        <div className="px-2 py-3">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/46">Project notes</span>
            {activeContextProject ? (
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={handleOpenNotesOverview}>
                Open all
              </Button>
            ) : null}
          </div>
          {activeContextProject ? (
            <div className="space-y-1">
              <TreeItem title={`${activeContextProject.name} Notes`} icon={<BookOpenText size={14} />} onClick={handleOpenNotesOverview} />
              {selectedProjectNotes.map((note) => (
                <TreeItem
                  key={note.id}
                  level={1}
                  title={noteTitle(note)}
                  active={activeTab.kind === "note" && activeTab.noteId === note.id}
                  trailing={note.pinned ? "pin" : undefined}
                  onClick={() => activeContextProject && handleOpenNoteTab(activeContextProject, note)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-[8px] border border-dashed border-[var(--vscode-border)] px-3 py-5 text-[12px] text-[var(--vscode-foreground)]/62">
              Select a project to browse its notes.
            </div>
          )}
        </div>
      );
    }

    if (activeSidebarView === "flows") {
      return (
        <div className="px-2 py-3">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/46">Project flows</span>
            {activeContextProject ? (
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={handleOpenFlowsOverview}>
                Open all
              </Button>
            ) : null}
          </div>
          {activeContextProject ? (
            <div className="space-y-1">
              <TreeItem title={`${activeContextProject.name} Flows`} icon={<GitBranch size={14} />} onClick={handleOpenFlowsOverview} />
              {selectedProjectFlows.map((flow) => (
                <TreeItem
                  key={flow.id}
                  level={1}
                  title={flow.name}
                  active={activeTab.kind === "flow" && activeTab.flowId === flow.id}
                  onClick={() => handleOpenFlowTab(activeContextProject, flow)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-[8px] border border-dashed border-[var(--vscode-border)] px-3 py-5 text-[12px] text-[var(--vscode-foreground)]/62">
              Select a project to browse its flows.
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="px-2 py-3">
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/46">Projects</span>
          <div className="flex items-center gap-1">
            <Tooltip content="Add Project" side="bottom">
              <button
                type="button"
                onClick={onAddProject}
                className="rounded-[6px] border border-transparent p-1 text-[var(--vscode-icon)] transition-[background-color,border-color,color] hover:border-[var(--vscode-border)] hover:bg-[var(--vscode-list-hover)] hover:text-foreground active:bg-[var(--vscode-list-active)]"
              >
                <Plus size={14} />
              </button>
            </Tooltip>
            <Tooltip content="Import .prd" side="bottom">
              <button
                type="button"
                onClick={onImportProject}
                className="rounded-[6px] border border-transparent p-1 text-[var(--vscode-icon)] transition-[background-color,border-color,color] hover:border-[var(--vscode-border)] hover:bg-[var(--vscode-list-hover)] hover:text-foreground active:bg-[var(--vscode-list-active)]"
              >
                <FileUp size={14} />
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="space-y-1">
          {projects.map((project) => {
            const projectCommands = commandsByProjectId[project.id] ?? [];
            const projectNotes = sortedProjectNotesByProjectId[project.id] ?? [];
            const projectSections = commandSectionsByProjectId[project.id] ?? [];
            const activeProject = activeContextProject?.id === project.id;
            return (
              <div key={project.id} className="space-y-1">
                <TreeItem
                  title={project.name}
                  icon={<FolderKanban size={14} />}
                  active={activeProject}
                  onClick={() => handleSelectProject(project.id)}
                  menuItems={getProjectMenuItems(project)}
                />
                {activeProject ? (
                  <>
                    <TreeItem
                      title="Overview"
                      level={1}
                      icon={<LayoutGrid size={13} />}
                      active={activeTab.kind === "project-overview"}
                      onClick={handleOpenProjectOverview}
                      menuItems={[
                        {
                          label: "Open overview",
                          icon: <LayoutGrid size={13} />,
                          onSelect: handleOpenProjectOverview,
                        },
                      ]}
                    />
                    <TreeItem
                      title="Commands"
                      level={1}
                      icon={commandsExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      active={activeTab.kind === "commands-overview" || activeTab.kind === "command"}
                      onClick={() => setCommandsExpanded((current) => !current)}
                      trailing={projectCommands.length}
                      menuItems={[
                        {
                          label: commandsExpanded ? "Collapse commands" : "Expand commands",
                          icon: commandsExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />,
                          onSelect: () => setCommandsExpanded((current) => !current),
                        },
                        ...getCommandsMenuItems(project),
                      ]}
                    />
                    {commandsExpanded ? (
                      <>
                        <TreeItem
                          title="Open commands view"
                          level={2}
                          active={activeTab.kind === "commands-overview"}
                          onClick={handleOpenCommandsOverview}
                          menuItems={getCommandsMenuItems(project)}
                        />
                        {projectSections.map((section) => (
                          <div key={section.section}>
                            <TreeItem
                              title={section.section}
                              level={2}
                              icon={<ListTree size={12} />}
                              trailing={section.commands.length}
                              menuItems={getCommandsMenuItems(project)}
                            />
                            {section.commands.map((command) => (
                              <TreeItem
                                key={command.id}
                                level={3}
                                title={command.name}
                                active={activeTab.kind === "command" && activeTab.commandId === command.id}
                                trailing={runs[command.id]?.status === "running" ? "run" : undefined}
                                onClick={() => handleOpenCommandTab(command)}
                                menuItems={getCommandMenuItems(command)}
                              />
                            ))}
                          </div>
                        ))}
                      </>
                    ) : null}
                    <TreeItem
                      title="Flows"
                      level={1}
                      icon={flowsExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      active={activeTab.kind === "flow" || activeTab.kind === "flows-overview"}
                      onClick={() => setFlowsExpanded((current) => !current)}
                      trailing={(flowsByProjectId[project.id] ?? []).length}
                      menuItems={[
                        { label: "Open flows view", icon: <LayoutGrid size={13} />, onSelect: handleOpenFlowsOverview },
                        { label: flowsExpanded ? "Collapse flows" : "Expand flows", icon: flowsExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />, onSelect: () => setFlowsExpanded((current) => !current) },
                      ]}
                    />
                    {flowsExpanded ? (
                      <>
                        <TreeItem title="Open flows view" level={2} icon={<LayoutGrid size={12} />} active={activeTab.kind === "flows-overview"} onClick={handleOpenFlowsOverview} />
                        {(flowsByProjectId[project.id] ?? []).map((flow) => (
                          <TreeItem key={flow.id} level={2} title={flow.name} icon={<GitBranch size={12} />} active={activeTab.kind === "flow" && activeTab.flowId === flow.id} onClick={() => handleOpenFlowTab(project, flow)} />
                        ))}
                      </>
                    ) : null}
                    <TreeItem
                      title="Notes"
                      level={1}
                      icon={notesExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      active={activeTab.kind === "notes-overview" || activeTab.kind === "note"}
                      onClick={() => setNotesExpanded((current) => !current)}
                      trailing={projectNotes.length}
                      menuItems={[
                        {
                          label: notesExpanded ? "Collapse notes" : "Expand notes",
                          icon: notesExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />,
                          onSelect: () => setNotesExpanded((current) => !current),
                        },
                        ...getNotesMenuItems(project),
                      ]}
                    />
                    {notesExpanded ? (
                      <>
                        <TreeItem
                          title="Open notes view"
                          level={2}
                          active={activeTab.kind === "notes-overview"}
                          onClick={handleOpenNotesOverview}
                          menuItems={getNotesMenuItems(project)}
                        />
                        {projectNotes.map((note) => (
                          <TreeItem
                            key={note.id}
                            level={2}
                            title={noteTitle(note)}
                            active={activeTab.kind === "note" && activeTab.noteId === note.id}
                            trailing={note.pinned ? "pin" : undefined}
                            onClick={() => handleOpenNoteTab(project, note)}
                            menuItems={getNoteMenuItems(project, note)}
                          />
                        ))}
                      </>
                    ) : null}
                  </>
                ) : null}
              </div>
            );
          })}
          {projects.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-[var(--vscode-border)] px-3 py-5 text-[12px] text-[var(--vscode-foreground)]/62">
              No local projects yet.
            </div>
          ) : null}
        </div>
      </div>
    );
  })();

  return (
    <>
      <main className="app-shell flex h-full min-h-0 flex-1 overflow-hidden bg-[var(--vscode-shell)] text-foreground">
      <aside className="flex w-12 shrink-0 flex-col items-center justify-between border-r border-[var(--vscode-border)] bg-[var(--vscode-activity)]">
        <div className="flex w-full flex-col items-center pt-2">
          <SidebarIconButton label="Explorer" active={activeSidebarView === "explorer"} onClick={() => handleSwitchPrimarySidebar("explorer")}>
            <FolderKanban size={20} />
          </SidebarIconButton>
          <SidebarIconButton label="Flows" active={activeSidebarView === "flows"} onClick={() => handleSwitchPrimarySidebar("flows")}>
            <GitBranch size={20} />
          </SidebarIconButton>
          <SidebarIconButton label="Notes" active={activeSidebarView === "notes"} onClick={() => handleSwitchPrimarySidebar("notes")}>
            <BookOpenText size={20} />
          </SidebarIconButton>
          <SidebarIconButton label="Terminal" active={activeSidebarView === "terminal"} onClick={() => handleSwitchPrimarySidebar("terminal")}>
            <TerminalSquare size={20} />
          </SidebarIconButton>
        </div>
        <div className="flex w-full flex-col items-center pb-2">
          <SidebarIconButton label="Settings" active={activeSidebarView === "settings"} onClick={handleOpenSettings}>
            <Settings2 size={20} />
          </SidebarIconButton>
        </div>
      </aside>

      <Group
        orientation="horizontal"
        defaultLayout={sidebarLayout}
        onLayoutChanged={(layout) =>
          setSidebarLayout({
            sidebar: layout.sidebar ?? DEFAULT_SIDEBAR_LAYOUT.sidebar,
            editor: layout.editor ?? DEFAULT_SIDEBAR_LAYOUT.editor,
          })
        }
        className="min-h-0 flex-1"
      >
        <Panel
          id="sidebar"
          defaultSize={SIDEBAR_DEFAULT_SIZE}
          minSize={SIDEBAR_MIN_SIZE}
          maxSize={SIDEBAR_MAX_SIZE}
          className="min-h-0 min-w-0"
        >
          <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-[var(--vscode-border)] bg-[var(--vscode-sidebar)]">
            <div className="border-b border-[var(--vscode-border)] px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--vscode-foreground)]/58">
                {activeSidebarView === "explorer"
                  ? "Explorer"
                  : activeSidebarView === "flows"
                    ? "Flows"
                  : activeSidebarView === "notes"
                    ? "Notes"
                    : activeSidebarView === "terminal"
                      ? "Terminal"
                      : "Settings"}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{sidebarContent}</div>
          </aside>
        </Panel>

        <Separator className="relative -mx-1 w-2 cursor-col-resize bg-transparent before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-[var(--vscode-border)] before:transition-colors hover:before:bg-primary" />

        <Panel id="editor" minSize={EDITOR_MIN_SIZE} className="min-h-0 min-w-0">
          <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--vscode-editor)]">
            {activeTab.kind === "settings" ? null : (
              <header className="flex min-h-9 shrink-0 items-center border-b border-[var(--vscode-border)] bg-[var(--vscode-tabs)]">
                <div className="flex min-w-0 flex-1 overflow-x-auto">
                  {tabs.map((tab) => (
                    <div
                      key={tab.id}
                      className={cn(
                        "group flex h-9 min-w-[160px] max-w-[240px] items-center border-r border-[var(--vscode-border)] px-3 text-[12px] text-[var(--vscode-foreground)]/76 transition-[background-color,color] hover:bg-[var(--vscode-list-hover)] hover:text-foreground active:bg-[var(--vscode-list-active)]",
                        activeTabId === tab.id && "bg-[var(--vscode-editor)] text-foreground",
                      )}
                    >
                      <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => setActiveTabId(tab.id)}>
                        {tab.title}
                      </button>
                      {tab.kind !== "welcome" ? (
                        <button
                          type="button"
                          className={cn(
                            "ml-2 rounded-[4px] border border-transparent p-1 text-[var(--vscode-icon)] transition-[opacity,background-color,border-color,color] hover:border-[var(--vscode-border)] hover:bg-[var(--vscode-list-hover)] hover:text-foreground active:bg-[var(--vscode-list-active)]",
                            activeTabId === tab.id ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                          )}
                          onClick={() => closeTab(tab.id)}
                          aria-label={`Close ${tab.title}`}
                        >
                          <X size={12} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </header>
            )}

            <div className="min-h-0 flex-1 overflow-hidden">{editorBody}</div>

            {activeTab.kind === "settings" ? null : (
              <div className="shrink-0 border-t border-[var(--vscode-border)] bg-[var(--vscode-panel)]">
                <LogPanel
                  activeCommandId={activeLogCommandId}
                  commands={commands}
                  projects={projects}
                  openCommandIds={openLogCommandIds}
                  onActiveCommandChange={onActiveLogCommandChange}
                  onClear={onClearLogs}
                  onCloseTab={onCloseLogTab}
                  onTerminalInput={onTerminalInput}
                  onTerminalResize={onTerminalResize}
                  onOpenAdHocInteractiveTerminal={onOpenAdHocInteractiveTerminal}
                  onRequestCloseAllTabs={onRequestCloseAllLogTabs}
                  interactiveTerminalOptions={interactiveTerminalOptions}
                  runs={runs}
                  terminalContentByCommandId={terminalContentByCommandId}
                  terminalFontFamily={terminalFontFamily}
                  terminalFontSize={terminalFontSize}
                  theme={theme}
                />
              </div>
            )}

            <footer className="flex h-6 shrink-0 items-center justify-between gap-3 border-t border-[var(--vscode-status-border)] bg-[var(--vscode-status)] px-3 text-[11px] text-[var(--vscode-status-foreground)]">
              <div className="flex min-w-0 items-center gap-4 overflow-hidden">
                <span className="truncate">{activeContextProject ? activeContextProject.name : "No project selected"}</span>
                <span>{selectedProjectCommands.length} commands</span>
                <span>{runningCount} running</span>
              </div>
              <div className="flex items-center gap-4">
                {updateVersion && (updateStatus === "available" || updateStatus === "downloading" || updateStatus === "downloaded") ? (
                  <button type="button" onClick={onOpenUpdate} className="rounded px-1 text-[var(--vscode-status-foreground)] hover:bg-white/12 hover:text-white">
                    {updateStatus === "downloading" ? "Downloading update" : updateStatus === "downloaded" ? `Update v${updateVersion} ready` : "Update available"}
                  </button>
                ) : null}
                <span>{theme} theme</span>
                <span>{openLogCommandIds.length} terminal tabs</span>
              </div>
            </footer>
          </section>
        </Panel>
      </Group>
      </main>
      <FlowFormDialog
        open={flowDialogProject !== null}
        projectName={flowDialogProject?.name ?? null}
        isPending={isCreatingFlow}
        error={flowCreationError}
        onOpenChange={(open) => {
          if (!open && !isCreatingFlow) {
            setFlowDialogProject(null);
            setFlowCreationError(null);
          }
        }}
        onSubmit={(name) => {
          if (flowDialogProject) void submitFlow(flowDialogProject, name);
        }}
      />
    </>
  );
});
