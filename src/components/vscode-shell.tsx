import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpenText,
  CalendarDays,
  Clipboard,
  ChevronDown,
  ChevronRight,
  ChevronsUp,
  CopyPlus,
  Eye,
  EyeOff,
  FilePenLine,
  FilePlus,
  FileText,
  Folder,
  FileUp,
  FolderKanban,
  GitBranch,
  FolderOpen,
  FolderPlus,
  HardDrive,
  LayoutGrid,
  List,
  LoaderCircle,
  ListTree,
  Pencil,
  Pin,
  PinOff,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  PowerOff,
  RotateCcw,
  RefreshCw,
  Scissors,
  Search,
  Square,
  Settings2,
  Trash2,
  TerminalSquare,
  Play,
  X,
} from "lucide-react";
import { Group, Panel, Separator, type GroupImperativeHandle, type Layout } from "react-resizable-panels";
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
import { CommandSectionDialog } from "./command-section-dialog";
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
import { ConfirmDialog } from "./process-dialogs";
import { VscFile, VscFileCode, VscFileMedia, VscFilePdf, VscFileZip, VscJson, VscMarkdown } from "react-icons/vsc";

type SidebarView = "explorer" | "flows" | "notes" | "terminal" | "settings";

export type VSCodeShellHandle = {
  openProject: (projectId: number) => void;
  openCommand: (projectId: number, commandId: number) => void;
  openNote: (projectId: number, noteId: string) => void;
  openFlow: (projectId: number, flowId: number) => void;
  toggleSecondarySidebar: () => void;
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
  | { id: string; kind: "file-view"; title: string; projectId: number; relativePath: string }
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
const FILE_EXPLORER_SIDEBAR_KEY = "vscodeFileExplorerSidebar";
const FILE_EXPLORER_PREFERENCES_KEY = "vscodeFileExplorerPreferences";

type QuickAccessEntry = { projectId: number; relativePath: string; name: string; isDirectory: boolean };
type FileExplorerPreferences = { quickAccess: QuickAccessEntry[]; detailsCollapsed: boolean; quickAccessCollapsed: boolean; detailsExpandedSize: number; quickAccessExpandedSize: number; panelLayout: Layout };
const DEFAULT_FILE_EXPLORER_PREFERENCES: FileExplorerPreferences = { quickAccess: [], detailsCollapsed: false, quickAccessCollapsed: false, detailsExpandedSize: 25, quickAccessExpandedSize: 23, panelLayout: { "file-tree": 52, "file-details": 25, "quick-access": 23 } };

function readFileExplorerPreferences(): FileExplorerPreferences {
  if (typeof window === "undefined") return DEFAULT_FILE_EXPLORER_PREFERENCES;
  try {
    const saved = JSON.parse(localStorage.getItem(FILE_EXPLORER_PREFERENCES_KEY) ?? "{}") as { quickAccess?: unknown; detailsCollapsed?: unknown; quickAccessCollapsed?: unknown; detailsExpandedSize?: unknown; quickAccessExpandedSize?: unknown; panelLayout?: unknown };
    return {
      quickAccess: Array.isArray(saved.quickAccess) ? saved.quickAccess.filter((item: unknown): item is QuickAccessEntry => Boolean(item) && typeof (item as QuickAccessEntry).projectId === "number" && typeof (item as QuickAccessEntry).relativePath === "string" && typeof (item as QuickAccessEntry).name === "string" && typeof (item as QuickAccessEntry).isDirectory === "boolean") : [],
      detailsCollapsed: Boolean(saved.detailsCollapsed),
      quickAccessCollapsed: Boolean(saved.quickAccessCollapsed),
      detailsExpandedSize: typeof saved.detailsExpandedSize === "number" ? Math.max(18, saved.detailsExpandedSize) : DEFAULT_FILE_EXPLORER_PREFERENCES.detailsExpandedSize,
      quickAccessExpandedSize: typeof saved.quickAccessExpandedSize === "number" ? Math.max(14, saved.quickAccessExpandedSize) : DEFAULT_FILE_EXPLORER_PREFERENCES.quickAccessExpandedSize,
      panelLayout: saved.panelLayout && typeof saved.panelLayout === "object" ? saved.panelLayout as Layout : DEFAULT_FILE_EXPLORER_PREFERENCES.panelLayout,
    };
  } catch {
    return DEFAULT_FILE_EXPLORER_PREFERENCES;
  }
}

function readFileExplorerSidebar(): { secondarySidebarVisible: boolean; fileExplorerVisible: boolean; fileExplorerWidth: number } {
  if (typeof window === "undefined") return { secondarySidebarVisible: true, fileExplorerVisible: false, fileExplorerWidth: 320 };
  try {
    const saved = JSON.parse(localStorage.getItem(FILE_EXPLORER_SIDEBAR_KEY) ?? "{}") as { secondarySidebarVisible?: unknown; fileExplorerVisible?: unknown; fileExplorerWidth?: unknown };
    return {
      secondarySidebarVisible: typeof saved.secondarySidebarVisible === "boolean" ? saved.secondarySidebarVisible : true,
      fileExplorerVisible: typeof saved.fileExplorerVisible === "boolean" ? saved.fileExplorerVisible : false,
      fileExplorerWidth: typeof saved.fileExplorerWidth === "number" ? Math.max(240, Math.min(620, saved.fileExplorerWidth)) : 320,
    };
  } catch {
    return { secondarySidebarVisible: true, fileExplorerVisible: false, fileExplorerWidth: 320 };
  }
}

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

function fileViewTab(project: Project, relativePath: string): EditorTab {
  return { id: `file-view:${project.id}:${relativePath}`, kind: "file-view", projectId: project.id, relativePath, title: relativePath.split("/").pop() ?? relativePath };
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
  onDoubleClick,
  icon,
  title,
  preserveExtension = false,
  trailing,
  menuItems,
  editTitle,
}: {
  level?: number;
  active?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  icon?: React.ReactNode;
  title: string;
  preserveExtension?: boolean;
  trailing?: React.ReactNode;
  menuItems?: {
    label?: string;
    icon?: React.ReactNode;
    onSelect?: () => void;
    disabled?: boolean;
    tone?: "default" | "danger";
    separator?: boolean;
  }[];
  editTitle?: {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onCancel: () => void;
    isPending?: boolean;
  };
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
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const hasMenu = Boolean(menuItems?.some((item) => !item.separator));
  const menuOpen = menuState !== null;
  const isEditingTitle = Boolean(editTitle);
  const titleLastDot = preserveExtension ? title.lastIndexOf(".") : -1;
  const titleStem = titleLastDot > 0 ? title.slice(0, titleLastDot) : title;
  const titleEnding = titleLastDot > 0 ? title.slice(titleLastDot) : "";
  const shouldMiddleTruncate = title.length > 28;

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

  useEffect(() => {
    if (!isEditingTitle) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [isEditingTitle]);

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
        {editTitle ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 self-stretch px-2" style={{ paddingLeft: `${8 + level * 14}px` } as CSSProperties}>
            {icon ? <span className={cn("shrink-0 text-[var(--vscode-icon)]", active && "text-primary")}>{icon}</span> : null}
            <input
              ref={titleInputRef}
              value={editTitle.value}
              disabled={editTitle.isPending}
              onChange={(event) => editTitle.onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  editTitle.onSubmit();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  editTitle.onCancel();
                }
              }}
              onBlur={editTitle.onSubmit}
              onClick={(event) => event.stopPropagation()}
              className="h-5 min-w-0 flex-1 rounded-[3px] border border-primary bg-[var(--vscode-input-background)] px-1 text-[12px] text-foreground outline-none"
              aria-label={`Rename ${title}`}
            />
            {trailing ? <span className={cn("shrink-0 text-[11px] text-muted-foreground", active && "text-foreground/80")}>{trailing}</span> : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            className="flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-[6px] px-2 text-left"
            style={{ paddingLeft: `${8 + level * 14}px` } as CSSProperties}
          >
            {icon ? <span className={cn("shrink-0 text-[var(--vscode-icon)]", active && "text-primary")}>{icon}</span> : null}
            {shouldMiddleTruncate ? <span className="flex min-w-0 flex-1"><span className="truncate">{titleStem}</span><span className="shrink-0">…{titleStem.slice(-3)}{titleEnding}</span></span> : <span className="truncate">{title}</span>}
            {trailing ? <span className={cn("ml-auto shrink-0 text-[11px] text-muted-foreground", active && "text-foreground/80")}>{trailing}</span> : null}
          </button>
        )}
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
          {menuItems?.map((item, index) => item.separator ? (
            <div key={`separator-${index}`} role="separator" className="my-1 h-px bg-[var(--vscode-border)]" />
          ) : (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) {
                  return;
                }
                setMenuState(null);
                item.onSelect?.();
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

type TabMenuItem = {
  label?: string;
  icon?: React.ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  separator?: boolean;
};

function TabContextMenu({ x, y, items, onClose }: { x: number; y: number; items: TabMenuItem[]; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x, y });

  useEffect(() => {
    setPosition({ x, y });
  }, [x, y]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  useEffect(() => {
    const rect = menuRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition((current) => ({
      x: Math.max(8, Math.min(current.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(current.y, window.innerHeight - rect.height - 8)),
    }));
  }, []);

  return (
    <div ref={menuRef} className="fixed z-[1000] min-w-[190px] overflow-hidden rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-panel)] p-1 shadow-[var(--split-menu-shadow)]" style={{ left: position.x, top: position.y }}>
      {items.map((item, index) => item.separator ? (
        <div key={`separator-${index}`} role="separator" className="my-1 h-px bg-[var(--vscode-border)]" />
      ) : (
        <button
          key={item.label}
          type="button"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            onClose();
            item.onSelect?.();
          }}
          className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12px] text-[var(--vscode-foreground)] transition-[background-color,color] hover:bg-[var(--vscode-list-hover)] hover:text-foreground active:bg-[var(--vscode-list-active)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {item.icon ? <span className="shrink-0">{item.icon}</span> : null}
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

type FileClipboard = { relativePath: string; cut: boolean } | null;
const PROJECT_FILE_PAGE_SIZE = 64;

function useProjectDirectoryEntries(projectId: number | undefined, relativePath: string, enabled: boolean, refreshVersion: number) {
  const [entries, setEntries] = useState<import("../lib/api").ProjectFileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !projectId) {
      setEntries([]);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setEntries([]);
    setError(null);
    setIsLoading(true);
    const load = async () => {
      let offset = 0;
      let hasMore = true;
      try {
        while (hasMore && !cancelled) {
          const page = await api.listProjectFilesPage(projectId, relativePath, offset, PROJECT_FILE_PAGE_SIZE);
          if (cancelled) return;
          setEntries((current) => [...current, ...page.entries]);
          offset += PROJECT_FILE_PAGE_SIZE;
          hasMore = page.has_more;
          if (hasMore) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
      } catch (value) {
        if (!cancelled) setError(value instanceof Error ? value.message : "Unable to read folder.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [enabled, projectId, refreshVersion, relativePath]);

  return { entries, isLoading, error };
}

function formatCompactCount(value: number) {
  if (value < 1000) return String(value);
  const units = ["k", "m", "b"];
  const unit = Math.min(Math.floor(Math.log10(value) / 3) - 1, units.length - 1);
  return `${(value / 1000 ** (unit + 1)).toFixed(1)}${units[unit]}`;
}

function formatFileSize(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)) - 1, units.length - 1);
  return `${(value / 1024 ** (unit + 1)).toFixed(1)} ${units[unit]}`;
}

function FileDetailRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex items-center gap-2"><span className="shrink-0 text-[var(--vscode-icon)]">{icon}</span><span>{children}</span></div>;
}

function ProjectFileIcon({ name, isDirectory }: { name: string; isDirectory: boolean }) {
  if (isDirectory) return <FolderOpen size={14} className="text-[#dcb67a]" />;
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "json") return <VscJson className="text-[#cbcb41]" size={15} />;
  if (["ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "css", "html", "yml", "yaml"].includes(extension)) return <VscFileCode className="text-[#519aba]" size={15} />;
  if (["md", "mdx"].includes(extension)) return <VscMarkdown className="text-[#519aba]" size={15} />;
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(extension)) return <VscFileMedia className="text-[#c586c0]" size={15} />;
  if (extension === "pdf") return <VscFilePdf className="text-[#f14c4c]" size={15} />;
  if (["zip", "7z", "rar", "tar", "gz"].includes(extension)) return <VscFileZip className="text-[#d7ba7d]" size={15} />;
  return <VscFile className="text-[#9cdcfe]" size={15} />;
}

function ProjectFileTree({ project, entry, level, selectedPath, onSelect, clipboard, collapseVersion, refreshVersion, onCreate, onCopy, onCut, onPaste, onRename, onDelete, onReveal, onOpenTerminal, onView, onOpenExternal, onToggleQuickAccess, pinnedPaths }: {
  project: Project; entry: import("../lib/api").ProjectFileEntry; level: number; selectedPath: string; onSelect: (entry: import("../lib/api").ProjectFileEntry) => void; clipboard: FileClipboard; collapseVersion: number;
  onCreate: (parentPath: string, kind: "file" | "folder") => void; onCopy: (path: string) => void; onCut: (path: string) => void; onPaste: (path: string) => void; onRename: (entry: import("../lib/api").ProjectFileEntry) => void; onDelete: (entry: import("../lib/api").ProjectFileEntry) => void; onReveal: (path: string) => void; onOpenTerminal: (relativeDirectoryPath: string) => void; onView: (entry: import("../lib/api").ProjectFileEntry) => void; onOpenExternal: (path: string) => void; onToggleQuickAccess: (entry: import("../lib/api").ProjectFileEntry) => void; pinnedPaths: Set<string>; refreshVersion: number;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  useEffect(() => { setIsExpanded(false); }, [collapseVersion]);
  const directoryEntries = useProjectDirectoryEntries(project.id, entry.relative_path, entry.is_directory && isExpanded, refreshVersion);
  const targetPath = entry.is_directory ? entry.relative_path : entry.relative_path.split("/").slice(0, -1).join("/");
  const menuItems = [
    { label: "View", icon: <Eye size={13} />, onSelect: () => onView(entry), disabled: entry.is_directory || (entry.file_kind !== "text" && !["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(entry.name.split(".").pop()?.toLowerCase() ?? "")) },
    { label: pinnedPaths.has(entry.relative_path) ? "Unpin from Quick Access" : "Pin to Quick Access", icon: pinnedPaths.has(entry.relative_path) ? <PinOff size={13} /> : <Pin size={13} />, onSelect: () => onToggleQuickAccess(entry) },
    { separator: true },
    { label: "New File", icon: <FilePlus size={13} />, onSelect: () => onCreate(targetPath, "file") },
    { label: "New Folder", icon: <FolderPlus size={13} />, onSelect: () => onCreate(targetPath, "folder") },
    { separator: true },
    { label: "Reveal in File Explorer", icon: <FolderOpen size={13} />, onSelect: () => onReveal(entry.relative_path) },
    { label: "Open in Internal Interactive Terminal", icon: <TerminalSquare size={13} />, onSelect: () => onOpenTerminal(entry.is_directory ? entry.relative_path : targetPath) },
    { separator: true },
    { label: "Copy", icon: <CopyPlus size={13} />, onSelect: () => onCopy(entry.relative_path) },
    { label: "Cut", icon: <Scissors size={13} />, onSelect: () => onCut(entry.relative_path) },
    { label: "Paste", icon: <Clipboard size={13} />, onSelect: () => onPaste(targetPath), disabled: !clipboard },
    { separator: true },
    { label: "Copy Full Path", icon: <CopyPlus size={13} />, onSelect: () => void navigator.clipboard.writeText(`${project.path}${entry.relative_path ? `/${entry.relative_path}` : ""}`) },
    { label: "Copy Relative Path", icon: <CopyPlus size={13} />, onSelect: () => void navigator.clipboard.writeText(entry.relative_path) },
    { separator: true },
    { label: "Rename", icon: <Pencil size={13} />, onSelect: () => onRename(entry) },
    { label: "Delete", icon: <Trash2 size={13} />, onSelect: () => onDelete(entry), tone: "danger" as const },
  ];
  return <div>
    <TreeItem title={entry.name} preserveExtension={!entry.is_directory} level={level} active={selectedPath === entry.relative_path} icon={entry.is_directory ? (isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <ProjectFileIcon name={entry.name} isDirectory={false} />} trailing={directoryEntries.isLoading ? <LoaderCircle size={12} className="animate-spin" /> : entry.line_count !== null ? <span className={cn(entry.line_count >= 1_000_000 ? "text-[var(--vscode-danger)]" : entry.line_count >= 1_000 ? "text-[#d7ba7d]" : "text-[var(--vscode-foreground)]/52")}>{formatCompactCount(entry.line_count)}</span> : undefined} onClick={() => { onSelect(entry); if (entry.is_directory) setIsExpanded((current) => !current); }} onDoubleClick={() => { if (!entry.is_directory) onOpenExternal(entry.relative_path); }} menuItems={menuItems} />
    {entry.is_directory && isExpanded ? <div>{directoryEntries.error ? <div className="px-3 py-1 text-[11px] text-[var(--vscode-danger)]" style={{ paddingLeft: `${24 + (level + 1) * 14}px` }}>{directoryEntries.error}</div> : null}{directoryEntries.entries.map((child) => <ProjectFileTree key={child.relative_path} project={project} entry={child} level={level + 1} selectedPath={selectedPath} onSelect={onSelect} clipboard={clipboard} collapseVersion={collapseVersion} refreshVersion={refreshVersion} onCreate={onCreate} onCopy={onCopy} onCut={onCut} onPaste={onPaste} onRename={onRename} onDelete={onDelete} onReveal={onReveal} onOpenTerminal={onOpenTerminal} onView={onView} onOpenExternal={onOpenExternal} onToggleQuickAccess={onToggleQuickAccess} pinnedPaths={pinnedPaths} />)}</div> : null}
  </div>;
}

function ProjectFileExplorer({ project, onOpenTerminal, onView }: { project: Project | null; onOpenTerminal: (relativeDirectoryPath: string) => void; onView: (relativePath: string) => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<FileClipboard>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedQuickAccessPath, setSelectedQuickAccessPath] = useState<string | null>(null);
  const [collapseVersion, setCollapseVersion] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<import("../lib/api").ProjectFileEntry | null>(null);
  const [missingQuickAccessEntry, setMissingQuickAccessEntry] = useState<QuickAccessEntry | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [preferences, setPreferences] = useState<FileExplorerPreferences>(() => readFileExplorerPreferences());
  const panelGroupRef = useRef<GroupImperativeHandle | null>(null);
  const panelGroupElementRef = useRef<HTMLDivElement | null>(null);
  const quickAccessValidationRequest = useRef(0);
  const rootDirectory = useProjectDirectoryEntries(project?.id, "", Boolean(project), refreshVersion);
  const selectedInfoQuery = useQuery({
    queryKey: ["project-file-info", project?.id, selectedPath ?? ""],
    queryFn: () => api.getProjectFileInfo(project!.id, selectedPath ?? ""),
    enabled: Boolean(project),
  });
  const invalidate = async () => {
    setRefreshVersion((current) => current + 1);
    if (!project) return;
    if (selectedPath) {
      const selectedStillExists = await api.projectFileExists(project.id, selectedPath).catch(() => true);
      if (!selectedStillExists) {
        queryClient.removeQueries({ queryKey: ["project-file-info", project.id, selectedPath], exact: true });
        setSelectedPath(null);
        setSelectedQuickAccessPath(null);
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["project-file-info", project.id] });
  };
  const run = (operation: Promise<unknown>) => void operation.then(invalidate).catch((value: unknown) => setError(value instanceof Error ? value.message : "File operation failed."));
  useEffect(() => { setError(null); setClipboard(null); setSelectedPath(null); setSelectedQuickAccessPath(null); setMissingQuickAccessEntry(null); quickAccessValidationRequest.current += 1; }, [project?.id]);
  useEffect(() => { localStorage.setItem(FILE_EXPLORER_PREFERENCES_KEY, JSON.stringify(preferences)); }, [preferences]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const group = panelGroupRef.current;
      const groupHeight = panelGroupElementRef.current?.clientHeight ?? 0;
      if (!group || groupHeight <= 0) return;

      const collapsedSize = Math.min(30 / groupHeight * 100, 30);
      let detailsSize = preferences.detailsCollapsed ? collapsedSize : preferences.detailsExpandedSize;
      let quickAccessSize = preferences.quickAccessCollapsed ? collapsedSize : preferences.quickAccessExpandedSize;
      const maxBottomPanelSize = 65;
      const overflow = detailsSize + quickAccessSize - maxBottomPanelSize;
      if (overflow > 0) {
        if (!preferences.detailsCollapsed) detailsSize = Math.max(18, detailsSize - overflow);
        if (detailsSize + quickAccessSize > maxBottomPanelSize && !preferences.quickAccessCollapsed) quickAccessSize = Math.max(14, maxBottomPanelSize - detailsSize);
      }
      group.setLayout({
        "file-tree": 100 - detailsSize - quickAccessSize,
        "file-details": detailsSize,
        "quick-access": quickAccessSize,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [preferences.detailsCollapsed, preferences.detailsExpandedSize, preferences.quickAccessCollapsed, preferences.quickAccessExpandedSize]);
  if (!project) return <div className="p-4 text-[12px] text-[var(--vscode-foreground)]/60">Select a project to browse its files.</div>;
  const selectedInfo = selectedInfoQuery.data ?? null;
  const selectedInfoError = selectedInfoQuery.error instanceof Error ? selectedInfoQuery.error.message : selectedInfoQuery.error ? "Unable to load file details." : null;
  const selectEntry = (entry: import("../lib/api").ProjectFileEntry) => {
    setSelectedPath(entry.relative_path);
    setSelectedQuickAccessPath(null);
  };
  const create = (parentPath: string, kind: "file" | "folder") => { const name = window.prompt(kind === "file" ? "New file name" : "New folder name"); if (name?.trim()) run((kind === "file" ? api.createProjectFile : api.createProjectFolder)(project.id, parentPath, name.trim())); };
  const rename = (entry: import("../lib/api").ProjectFileEntry) => {
    const name = window.prompt("New name", entry.name);
    if (!name?.trim() || name.trim() === entry.name) return;
    const affectsSelection = selectedPath === entry.relative_path || selectedPath?.startsWith(`${entry.relative_path}/`);
    void api.renameProjectFile(project.id, entry.relative_path, name.trim())
      .then(() => {
        if (affectsSelection) {
          setSelectedPath(null);
          setSelectedQuickAccessPath(null);
        }
        return invalidate();
      })
      .catch((value: unknown) => setError(value instanceof Error ? value.message : "File operation failed."));
  };
  const paste = (targetPath: string) => { if (clipboard) run(api.pasteProjectFile(project.id, clipboard.relativePath, targetPath, clipboard.cut)); if (clipboard?.cut) setClipboard(null); };
  const quickAccess = preferences.quickAccess.filter((entry) => entry.projectId === project.id);
  const pinnedPaths = new Set(quickAccess.map((entry) => entry.relativePath));
  const toggleQuickAccess = (entry: import("../lib/api").ProjectFileEntry) => setPreferences((current) => {
    const exists = current.quickAccess.some((item) => item.projectId === project.id && item.relativePath === entry.relative_path);
    return { ...current, quickAccess: exists ? current.quickAccess.filter((item) => item.projectId !== project.id || item.relativePath !== entry.relative_path) : [...current.quickAccess, { projectId: project.id, relativePath: entry.relative_path, name: entry.name, isDirectory: entry.is_directory }] };
  });
  const removeQuickAccess = (relativePath: string, includeChildren = false) => {
    setPreferences((current) => ({
      ...current,
      quickAccess: current.quickAccess.filter((item) => item.projectId !== project.id || (includeChildren ? (item.relativePath !== relativePath && !item.relativePath.startsWith(`${relativePath}/`)) : item.relativePath !== relativePath)),
    }));
    if (selectedQuickAccessPath === relativePath || (includeChildren && selectedQuickAccessPath?.startsWith(`${relativePath}/`))) setSelectedQuickAccessPath(null);
  };
  const deleteEntry = (entry: import("../lib/api").ProjectFileEntry) => {
    void api.deleteProjectFile(project.id, entry.relative_path)
      .then(() => {
        removeQuickAccess(entry.relative_path, entry.is_directory);
        if (selectedPath === entry.relative_path || selectedPath?.startsWith(`${entry.relative_path}/`)) {
          setSelectedPath(null);
          setSelectedQuickAccessPath(null);
        }
        return invalidate();
      })
      .catch((value: unknown) => setError(value instanceof Error ? value.message : "File operation failed."));
  };
  const selectQuickAccess = (entry: QuickAccessEntry) => {
    setSelectedPath(entry.relativePath);
    setSelectedQuickAccessPath(entry.relativePath);
    const request = ++quickAccessValidationRequest.current;
    void api.projectFileExists(project.id, entry.relativePath)
      .then((exists) => {
        if (request === quickAccessValidationRequest.current && !exists) setMissingQuickAccessEntry(entry);
      })
      .catch((value: unknown) => {
        if (request === quickAccessValidationRequest.current) setError(value instanceof Error ? value.message : "Unable to validate Quick Access item.");
      });
  };
  const toggleDetailsPanel = () => {
    setPreferences((current) => ({ ...current, detailsCollapsed: !current.detailsCollapsed }));
  };
  const toggleQuickAccessPanel = () => {
    setPreferences((current) => ({ ...current, quickAccessCollapsed: !current.quickAccessCollapsed }));
  };
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex items-center justify-between border-b border-[var(--vscode-border)] px-3 py-2"><span className="flex min-w-0 items-center gap-2 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/62">{project.name}{rootDirectory.isLoading ? <LoaderCircle size={12} className="shrink-0 animate-spin" /> : null}</span><div className="flex items-center gap-0.5"><Tooltip content="New File"><button type="button" className="p-1 hover:bg-[var(--vscode-list-hover)]" onClick={() => create("", "file")}><FilePlus size={14} /></button></Tooltip><Tooltip content="New Folder"><button type="button" className="p-1 hover:bg-[var(--vscode-list-hover)]" onClick={() => create("", "folder")}><FolderPlus size={14} /></button></Tooltip><Tooltip content="Refresh Explorer"><button type="button" className="p-1 hover:bg-[var(--vscode-list-hover)]" onClick={() => void invalidate()}><RefreshCw size={14} /></button></Tooltip><Tooltip content="Collapse All"><button type="button" className="p-1 hover:bg-[var(--vscode-list-hover)]" onClick={() => setCollapseVersion((current) => current + 1)}><ChevronsUp size={14} /></button></Tooltip></div></div>
    <Group orientation="vertical" groupRef={panelGroupRef} elementRef={panelGroupElementRef} defaultLayout={preferences.panelLayout} onLayoutChanged={(panelLayout) => setPreferences((current) => ({ ...current, panelLayout }))} className="min-h-0 flex-1">
      <Panel id="file-tree" minSize="35%" className="min-h-0 overflow-y-auto px-2 py-2">
        {error ? <div className="mb-2 text-[11px] text-[var(--vscode-danger)]">{error}</div> : null}
        {rootDirectory.error ? <div className="mb-2 text-[11px] text-[var(--vscode-danger)]">{rootDirectory.error}</div> : null}
        {rootDirectory.entries.map((entry) => <ProjectFileTree key={entry.relative_path} project={project} entry={entry} level={0} selectedPath={selectedPath ?? ""} onSelect={selectEntry} clipboard={clipboard} collapseVersion={collapseVersion} refreshVersion={refreshVersion} onCreate={create} onCopy={(relativePath) => setClipboard({ relativePath, cut: false })} onCut={(relativePath) => setClipboard({ relativePath, cut: true })} onPaste={paste} onRename={rename} onDelete={setDeleteTarget} onReveal={(relativePath) => run(api.revealProjectFile(project.id, relativePath))} onOpenTerminal={onOpenTerminal} onView={(entry) => { if (!entry.is_directory) onView(entry.relative_path); }} onOpenExternal={(relativePath) => run(api.openProjectFile(project.id, relativePath))} onToggleQuickAccess={toggleQuickAccess} pinnedPaths={pinnedPaths} />)}
      </Panel>
      <Separator className="h-1.5 cursor-row-resize bg-[var(--vscode-border)]" />
      <Panel id="file-details" defaultSize="25%" minSize="18%" collapsible collapsedSize="30px" onResize={(size) => setPreferences((current) => current.detailsCollapsed || Math.abs(current.detailsExpandedSize - size.asPercentage) < 0.1 ? current : { ...current, detailsExpandedSize: size.asPercentage })} className="min-h-[30px] overflow-hidden border-t border-[var(--vscode-border)]" style={preferences.detailsCollapsed ? { overflow: "hidden" } : undefined}>
        <div className="flex h-[30px] items-center justify-between px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/55"><span>Details</span><button type="button" className="rounded p-1 hover:bg-[var(--vscode-list-hover)]" onClick={toggleDetailsPanel} aria-label="Toggle details"><ChevronDown size={14} className={cn(preferences.detailsCollapsed && "-rotate-90")} /></button></div>
        {!preferences.detailsCollapsed ? <div className="overflow-y-auto px-3 pb-3">{selectedInfoQuery.isPending ? <div className="flex items-center gap-2 text-[11px] text-[var(--vscode-foreground)]/55"><LoaderCircle size={12} className="animate-spin" />Loading details…</div> : selectedInfoError ? <div className="text-[11px] text-[var(--vscode-danger)]">{selectedInfoError}</div> : selectedInfo ? <div className="grid gap-1.5 text-[11px] text-[var(--vscode-foreground)]/72"><div className="flex items-center gap-2 truncate font-medium text-foreground"><ProjectFileIcon name={selectedInfo.name} isDirectory={selectedInfo.is_directory} />{selectedInfo.name || project.name}</div><FileDetailRow icon={selectedInfo.file_kind === "folder" ? <Folder size={13} /> : <FileText size={13} />}>{selectedInfo.file_kind === "folder" ? "Folder" : `${selectedInfo.file_kind === "text" ? "Text" : "Binary"} file`}</FileDetailRow><FileDetailRow icon={<HardDrive size={13} />}>Size: {formatFileSize(selectedInfo.size_bytes)} ({selectedInfo.size_bytes.toLocaleString()} bytes)</FileDetailRow>{selectedInfo.file_kind === "folder" ? <FileDetailRow icon={<Folder size={13} />}>{selectedInfo.child_folder_count.toLocaleString()} folders · {selectedInfo.child_file_count.toLocaleString()} files</FileDetailRow> : null}{selectedInfo.line_count !== null ? <FileDetailRow icon={<List size={13} />}>Lines: {selectedInfo.line_count.toLocaleString()}</FileDetailRow> : null}<FileDetailRow icon={<CalendarDays size={13} />}>Created: {selectedInfo.created_at ? formatDateTime(selectedInfo.created_at) : "—"}</FileDetailRow><FileDetailRow icon={<CalendarDays size={13} />}>Modified: {selectedInfo.modified_at ? formatDateTime(selectedInfo.modified_at) : "—"}</FileDetailRow></div> : <div className="text-[11px] text-[var(--vscode-foreground)]/55">Select a file or folder.</div>}</div> : null}
      </Panel>
      <Separator className="h-1.5 cursor-row-resize bg-[var(--vscode-border)]" />
      <Panel id="quick-access" defaultSize="23%" minSize="14%" collapsible collapsedSize="30px" onResize={(size) => setPreferences((current) => current.quickAccessCollapsed || Math.abs(current.quickAccessExpandedSize - size.asPercentage) < 0.1 ? current : { ...current, quickAccessExpandedSize: size.asPercentage })} className="min-h-[30px] overflow-hidden border-t border-[var(--vscode-border)]" style={preferences.quickAccessCollapsed ? { overflow: "hidden" } : undefined}>
        <div className="flex h-[30px] items-center justify-between px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/55"><span>Quick Access</span><button type="button" className="rounded p-1 hover:bg-[var(--vscode-list-hover)]" onClick={toggleQuickAccessPanel} aria-label="Toggle quick access"><ChevronDown size={14} className={cn(preferences.quickAccessCollapsed && "-rotate-90")} /></button></div>
        {!preferences.quickAccessCollapsed ? <div className="overflow-y-auto px-2 pb-2">{quickAccess.length === 0 ? <div className="px-1 py-1 text-[11px] text-[var(--vscode-foreground)]/55">Pin a file or folder to open it quickly.</div> : quickAccess.map((entry) => <TreeItem key={entry.relativePath} title={entry.name} preserveExtension={!entry.isDirectory} active={selectedQuickAccessPath === entry.relativePath} icon={<ProjectFileIcon name={entry.name} isDirectory={entry.isDirectory} />} onClick={() => selectQuickAccess(entry)} onDoubleClick={() => { void api.openProjectFile(project.id, entry.relativePath).catch((value: unknown) => setError(value instanceof Error ? value.message : "Unable to open Quick Access item.")); }} menuItems={[{ label: "Remove from Quick Access", icon: <PinOff size={13} />, onSelect: () => removeQuickAccess(entry.relativePath), tone: "danger" }]} />)}</div> : null}
      </Panel>
    </Group>
    <ConfirmDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }} title="Delete file or folder" description={`Delete “${deleteTarget?.name ?? ""}”? This cannot be undone.`} confirmLabel="Delete" onConfirm={() => { if (deleteTarget) deleteEntry(deleteTarget); setDeleteTarget(null); }} />
    <ConfirmDialog open={missingQuickAccessEntry !== null} onOpenChange={(open) => { if (!open) setMissingQuickAccessEntry(null); }} title="Quick Access item is unavailable" description={`“${missingQuickAccessEntry?.name ?? ""}” no longer exists in this project. Remove it from Quick Access?`} confirmLabel="Remove" onConfirm={() => { if (missingQuickAccessEntry) { removeQuickAccess(missingQuickAccessEntry.relativePath); if (selectedPath === missingQuickAccessEntry.relativePath) setSelectedPath(null); } setMissingQuickAccessEntry(null); }} />
  </div>;
}

const SYNTAX_KEYWORDS = new Set([
  "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "def", "default", "else", "enum", "export", "extends", "false", "finally", "fn", "for", "from", "function", "if", "impl", "import", "in", "interface", "let", "match", "mod", "new", "null", "None", "pub", "return", "self", "static", "struct", "switch", "this", "throw", "trait", "true", "try", "type", "undefined", "use", "while", "with", "yield",
]);

function syntaxLanguage(relativePath: string) {
  const extension = relativePath.split(".").pop()?.toLowerCase() ?? "";
  const languages: Record<string, string> = {
    bash: "Shell", c: "C", cpp: "C++", css: "CSS", go: "Go", h: "C/C++", html: "HTML", htm: "HTML", java: "Java", js: "JavaScript", jsx: "JavaScript", json: "JSON", md: "Markdown", mdx: "Markdown", py: "Python", rs: "Rust", sh: "Shell", sql: "SQL", toml: "TOML", ts: "TypeScript", tsx: "TypeScript", xml: "XML", yaml: "YAML", yml: "YAML",
  };
  return languages[extension] ?? "Plain Text";
}

function syntaxTokens(line: string, relativePath: string, query: string, activeMatchStart: number | null): React.ReactNode[] {
  const extension = relativePath.split(".").pop()?.toLowerCase() ?? "";
  const hashComments = ["py", "yml", "yaml", "sh", "bash", "toml"].includes(extension);
  const markup = ["html", "htm", "xml", "svg"].includes(extension);
  const comments = markup ? "<!--.*?-->" : hashComments ? "#.*" : "//.*|/\\*.*?\\*/";
  const pattern = new RegExp(`(?:${comments})|(?:\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*'|\\\`(?:\\\\.|[^\\\`\\\\])*\\\`)|\\b(?:${[...SYNTAX_KEYWORDS].join("|")})\\b|\\b\\d+(?:\\.\\d+)?\\b|\\b[A-Za-z_$][\\w$]*(?=\\s*\\()|<\\/?[A-Za-z][^>]*>`, "g");
  const tokens: React.ReactNode[] = [];
  let cursor = 0;
  const append = (value: string, start: number, className?: string) => {
    if (!query) {
      tokens.push(className ? <span key={`${start}-${value}`} className={className}>{value}</span> : value);
      return;
    }
    const lowerValue = value.toLocaleLowerCase();
    const lowerQuery = query.toLocaleLowerCase();
    const parts: React.ReactNode[] = [];
    let valueCursor = 0;
    let matchAt = lowerValue.indexOf(lowerQuery);
    while (matchAt >= 0) {
      if (matchAt > valueCursor) parts.push(value.slice(valueCursor, matchAt));
      const matchStart = start + matchAt;
      parts.push(<mark key={`${matchStart}-${query}`} className={cn("rounded-[1px] bg-[#515c6a] px-px text-inherit", activeMatchStart === matchStart ? "bg-[#f9d849] text-[#1e1e1e]" : "bg-[color-mix(in_srgb,var(--primary-color)_42%,transparent)]")}>{value.slice(matchAt, matchAt + query.length)}</mark>);
      valueCursor = matchAt + query.length;
      matchAt = lowerValue.indexOf(lowerQuery, valueCursor);
    }
    if (valueCursor < value.length) parts.push(value.slice(valueCursor));
    tokens.push(className ? <span key={`${start}-${value}`} className={className}>{parts}</span> : <span key={`${start}-${value}`}>{parts}</span>);
  };

  for (const match of line.matchAll(pattern)) {
    const value = match[0];
    const index = match.index ?? 0;
    if (index > cursor) append(line.slice(cursor, index), cursor);
    const className = value.startsWith("//") || value.startsWith("/*") || value.startsWith("<!--") || (hashComments && value.startsWith("#"))
      ? "text-[var(--file-code-comment)]"
      : value.startsWith("\"") || value.startsWith("'") || value.startsWith("`")
        ? "text-[var(--file-code-string)]"
        : value.startsWith("<")
          ? "text-[var(--file-code-tag)]"
          : SYNTAX_KEYWORDS.has(value)
            ? "text-[var(--file-code-keyword)]"
            : /^\d/.test(value)
              ? "text-[var(--file-code-number)]"
              : "text-[var(--file-code-function)]";
    append(value, index, className);
    cursor = index + value.length;
  }
  if (cursor < line.length) append(line.slice(cursor), cursor);
  return tokens;
}

function ProjectFileViewer({ project, relativePath }: { project: Project; relativePath: string }) {
  const contentQuery = useQuery({ queryKey: ["project-file-content", project.id, relativePath], queryFn: () => api.readProjectFile(project.id, relativePath) });
  const lines = useMemo(() => contentQuery.data?.content?.split("\n") ?? [], [contentQuery.data?.content]);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [activeFindIndex, setActiveFindIndex] = useState(0);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const lineRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const matches = useMemo(() => {
    const query = findQuery.toLocaleLowerCase();
    if (!query) return [] as { line: number; start: number }[];
    const result: { line: number; start: number }[] = [];
    lines.forEach((line, lineIndex) => {
      const lowerLine = line.toLocaleLowerCase();
      let start = lowerLine.indexOf(query);
      while (start >= 0) {
        result.push({ line: lineIndex, start });
        start = lowerLine.indexOf(query, start + query.length);
      }
    });
    return result;
  }, [findQuery, lines]);
  const activeMatch = matches[activeFindIndex] ?? null;
  const lineNumberWidth = `${Math.max(4, String(Math.max(1, lines.length)).length + 1)}ch`;

  useEffect(() => {
    if (activeFindIndex >= matches.length) setActiveFindIndex(0);
  }, [activeFindIndex, matches.length]);
  useEffect(() => {
    if (findOpen) window.requestAnimationFrame(() => findInputRef.current?.focus());
  }, [findOpen]);
  useEffect(() => {
    if (activeMatch) lineRefs.current[activeMatch.line]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeMatch]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFindOpen(true);
      }
      if (event.key === "Escape" && findOpen) {
        event.preventDefault();
        setFindOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [findOpen]);
  const moveFindMatch = (direction: 1 | -1) => {
    if (!matches.length) return;
    setActiveFindIndex((current) => (current + direction + matches.length) % matches.length);
  };
  if (contentQuery.isLoading) return <div className="flex h-full items-center justify-center text-[12px] text-[var(--vscode-foreground)]/60"><LoaderCircle size={14} className="mr-2 animate-spin" /> Loading file…</div>;
  if (contentQuery.isError || !contentQuery.data) return <div className="p-5 text-[12px] text-[var(--vscode-danger)]">{contentQuery.error instanceof Error ? contentQuery.error.message : "Unable to view this file."}</div>;
  return <div className="flex h-full min-h-0 flex-col bg-[var(--vscode-editor)]"><div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--vscode-border)] px-5 py-2 text-[12px] text-[var(--vscode-foreground)]/70"><span className="truncate">{project.name} / {relativePath}</span>{contentQuery.data.file_kind === "text" ? <div className="flex shrink-0 items-center gap-2">{findOpen ? <div className="flex h-7 items-center rounded-[4px] border border-[var(--vscode-input-focus-border)] bg-[var(--vscode-input-background)] px-1 shadow-sm"><input ref={findInputRef} value={findQuery} onChange={(event) => { setFindQuery(event.target.value); setActiveFindIndex(0); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); moveFindMatch(event.shiftKey ? -1 : 1); } }} className="w-36 bg-transparent px-1.5 text-[11px] text-foreground outline-none" placeholder="Find" aria-label="Find in file" /><span className="min-w-[48px] text-right text-[10px] text-[var(--vscode-foreground)]/55">{findQuery ? `${matches.length ? activeFindIndex + 1 : 0}/${matches.length}` : ""}</span><button type="button" className="rounded p-1 hover:bg-[var(--vscode-list-hover)]" onClick={() => moveFindMatch(-1)} disabled={!matches.length} aria-label="Previous match"><ChevronDown size={13} className="rotate-180" /></button><button type="button" className="rounded p-1 hover:bg-[var(--vscode-list-hover)]" onClick={() => moveFindMatch(1)} disabled={!matches.length} aria-label="Next match"><ChevronDown size={13} /></button><button type="button" className="rounded p-1 hover:bg-[var(--vscode-list-hover)]" onClick={() => setFindOpen(false)} aria-label="Close find"><X size={13} /></button></div> : <button type="button" className="rounded p-1 hover:bg-[var(--vscode-list-hover)]" onClick={() => setFindOpen(true)} aria-label="Find in file"><Search size={14} /></button>}<span className="text-[10px] uppercase tracking-[0.08em] text-[var(--vscode-foreground)]/48">{syntaxLanguage(relativePath)} · {lines.length.toLocaleString()} lines</span></div> : null}</div>{contentQuery.data.file_kind === "image" ? <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6"><img src={contentQuery.data.data_url ?? ""} alt={relativePath} className="max-h-full max-w-full object-contain" /></div> : <div className="min-h-0 flex-1 overflow-auto py-3 font-mono text-[12px] leading-6"><div className="min-w-max">{lines.map((line, index) => <div key={index} ref={(element) => { lineRefs.current[index] = element; }} className="grid hover:bg-[var(--vscode-list-hover)]/35" style={{ gridTemplateColumns: `${lineNumberWidth} minmax(0, 1fr)` }}><span className="sticky left-0 select-none border-r border-[var(--vscode-border)] bg-[var(--vscode-editor)] px-3 text-right text-[var(--vscode-foreground)]/38">{index + 1}</span><code className="whitespace-pre px-4 text-[var(--file-code-base)]">{syntaxTokens(line, relativePath, findQuery, activeMatch?.line === index ? activeMatch.start : null)}</code></div>)}</div></div>}</div>;
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
  onAddSection,
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
  onAddCommand: (section?: string) => void;
  onAddSection: () => void;
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
      .filter(({ commands }) => !normalizedSearch || commands.length > 0);
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
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onAddSection}>
              <ListTree size={15} />
              Add section
            </Button>
            <Button onClick={() => onAddCommand()}>
              <Plus size={15} />
              Add command
            </Button>
          </div>
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
              <Button size="sm" variant="ghost" onClick={() => onAddCommand(section)}>
                <Plus size={14} />
                Add command
              </Button>
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
              {commands.length === 0 ? (
                <div className="col-span-full rounded-[8px] border border-dashed border-[var(--vscode-border)] px-4 py-6 text-center text-[12px] text-muted-foreground">
                  No commands in this section yet.
                </div>
              ) : null}
            </div>
          </section>
        ))}
        {visibleSections.length === 0 ? (
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
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-[var(--vscode-editor)] px-6 py-4">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col">
        <section>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="py-1">
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
            <div className="flex flex-wrap gap-2 py-1">
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
                <Trash2 size={14} />
                Delete
              </Button>
            </div>
          </div>
        </section>

        <div className="my-4 h-px bg-[var(--vscode-border)]" aria-hidden="true" />

        <div className="flex flex-col gap-6">
          <section className="w-full py-1">
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
    defaultSection?: string,
    preset?: {
      interactive_terminal_kind?: InteractiveTerminalKind | null;
      runtime_mode?: "internal_interactive" | "internal_headless" | "external_terminal" | null;
    } | null,
  ) => void;
  onAddSection: (projectId: number, name: string) => Promise<void>;
  onRenameSection: (projectId: number, sectionId: number, name: string) => Promise<void>;
  onDeleteSection: (projectId: number, sectionId: number) => Promise<void>;
  isMutatingSection: boolean;
  interactiveTerminalOptions: InteractiveTerminalOption[];
  defaultInteractiveTerminalKind: InteractiveTerminalKind;
  onRequestCloseAllLogTabs: (commandIds: number[]) => void;
  onOpenAdHocInteractiveTerminal: (project: Project, terminalKind: InteractiveTerminalKind, workingDirectory?: string) => void;
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
  onAddSection,
  onRenameSection,
  onDeleteSection,
  isMutatingSection,
  interactiveTerminalOptions,
  defaultInteractiveTerminalKind,
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
  const [pinnedTabIds, setPinnedTabIds] = useState<Set<string>>(() => new Set());
  const [flowDirtyById, setFlowDirtyById] = useState<Record<number, boolean>>({});
  const [pendingTabCloseIds, setPendingTabCloseIds] = useState<string[] | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const [isSecondarySidebarVisible, setIsSecondarySidebarVisible] = useState(() => readFileExplorerSidebar().secondarySidebarVisible);
  const [isFileExplorerVisible, setIsFileExplorerVisible] = useState(() => readFileExplorerSidebar().fileExplorerVisible);
  const [fileExplorerWidth, setFileExplorerWidth] = useState(() => readFileExplorerSidebar().fileExplorerWidth);
  const sidebarGroupRef = useRef<GroupImperativeHandle | null>(null);
  const sidebarGroupElementRef = useRef<HTMLDivElement | null>(null);
  const pendingFileExplorerLayoutRef = useRef<{ previousWidth: number; sidebar: number } | null>(null);
  const [flowDialogProject, setFlowDialogProject] = useState<Project | null>(null);
  const [isCreatingFlow, setIsCreatingFlow] = useState(false);
  const [flowCreationError, setFlowCreationError] = useState<string | null>(null);
  const [sectionDialogProject, setSectionDialogProject] = useState<Project | null>(null);
  const [sectionCreationError, setSectionCreationError] = useState<string | null>(null);
  const [editingFlow, setEditingFlow] = useState<ProjectFlow | null>(null);
  const [editingSidebarNote, setEditingSidebarNote] = useState<{ project: Project; note: ProjectNote } | null>(null);
  const [renameTarget, setRenameTarget] = useState<
    | { kind: "flow"; project: Project; flow: ProjectFlow }
    | { kind: "note"; project: Project; note: ProjectNote }
    | { kind: "terminal"; command: ProjectCommand }
    | { kind: "section"; project: Project; section: CommandSection }
    | null
  >(null);
  const [renameValue, setRenameValue] = useState("");
  const [terminalNames, setTerminalNames] = useState<Record<number, string>>({});
  const renameSubmittingRef = useRef(false);
  const renameCancelledRef = useRef(false);
  const [flowToDelete, setFlowToDelete] = useState<ProjectFlow | null>(null);
  const [sectionToDelete, setSectionToDelete] = useState<{ project: Project; section: CommandSection } | null>(null);
  const [commandsExpanded, setCommandsExpanded] = useState(() => localStorage.getItem("vscodeCommandsExpanded") !== "false");
  const [notesExpanded, setNotesExpanded] = useState(() => localStorage.getItem("vscodeNotesExpanded") !== "false");
  const [flowsExpanded, setFlowsExpanded] = useState(() => localStorage.getItem("vscodeFlowsExpanded") !== "false");
  const [sidebarLayout, setSidebarLayout] = useState<{ sidebar: number; editor: number }>(() => readSidebarLayout());
  const runningCount = Object.values(runs).filter((run) => run.status === "running").length;
  const activeTabProjectId = getProjectIdFromTab(tabs.find((tab) => tab.id === activeTabId) ?? welcomeTab());
  const activeContextProject = findProjectById(projects, activeTabProjectId ?? selectedProjectId ?? undefined) ?? selectedProject;
  const selectedProjectCommands = activeContextProject ? commandsByProjectId[activeContextProject.id] ?? [] : [];
  const selectedProjectNotes = activeContextProject ? sortedProjectNotesByProjectId[activeContextProject.id] ?? [] : [];
  const selectedProjectFlows = activeContextProject ? flowsByProjectId[activeContextProject.id] ?? [] : [];

  useLayoutEffect(() => {
    const pendingLayout = pendingFileExplorerLayoutRef.current;
    if (!pendingLayout) return;
    pendingFileExplorerLayoutRef.current = null;

    const nextWidth = sidebarGroupElementRef.current?.getBoundingClientRect().width ?? 0;
    if (!pendingLayout.previousWidth || !nextWidth) return;

    const sidebar = Math.max(
      SIDEBAR_MIN_LAYOUT,
      Math.min(SIDEBAR_MAX_LAYOUT, pendingLayout.sidebar * pendingLayout.previousWidth / nextWidth),
    );
    const nextLayout = { sidebar, editor: 100 - sidebar };
    sidebarGroupRef.current?.setLayout(nextLayout);
    setSidebarLayout(nextLayout);
  }, [isFileExplorerVisible]);

  function toggleFileExplorer() {
    // The file explorer sits beside (not inside) the resizable group. Preserve
    // the primary sidebar's pixel width before the browser paints the new layout.
    const previousWidth = sidebarGroupElementRef.current?.getBoundingClientRect().width ?? 0;
    pendingFileExplorerLayoutRef.current = { previousWidth, sidebar: sidebarLayout.sidebar };
    setIsFileExplorerVisible((current) => !current);
  }

  function startFileExplorerResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const initialX = event.clientX;
    const initialWidth = fileExplorerWidth;
    const handleMove = (moveEvent: PointerEvent) => setFileExplorerWidth(Math.max(240, Math.min(620, initialWidth + initialX - moveEvent.clientX)));
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }
  const updateFlowMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => api.updateFlow(id, name),
    onSuccess: (flow) => {
      renameSubmittingRef.current = false;
      renameCancelledRef.current = false;
      setEditingFlow(null);
      setRenameTarget(null);
      setRenameValue("");
      void queryClient.invalidateQueries({ queryKey: ["flows", flow.project_id] });
      void queryClient.invalidateQueries({ queryKey: ["flow", flow.id] });
    },
    onError: () => {
      renameSubmittingRef.current = false;
    },
  });

  function beginRename(target: NonNullable<typeof renameTarget>, value: string) {
    renameSubmittingRef.current = false;
    renameCancelledRef.current = false;
    setRenameValue(value);
    setRenameTarget(target);
  }

  function cancelRename() {
    if (updateFlowMutation.isPending || isMutatingSection) return;
    renameSubmittingRef.current = false;
    renameCancelledRef.current = true;
    setRenameTarget(null);
    setRenameValue("");
  }

  function submitRename() {
    if (renameSubmittingRef.current || renameCancelledRef.current) return;
    const name = renameValue.trim();
    if (!renameTarget || !name) {
      cancelRename();
      return;
    }
    renameSubmittingRef.current = true;
    if (renameTarget.kind === "flow") {
      updateFlowMutation.mutate({ id: renameTarget.flow.id, name });
      return;
    }
    if (renameTarget.kind === "section") {
      void onRenameSection(renameTarget.project.id, renameTarget.section.id, name)
        .then(() => {
          renameSubmittingRef.current = false;
          setRenameTarget(null);
          setRenameValue("");
        })
        .catch(() => {
          renameSubmittingRef.current = false;
        });
      return;
    }
    if (renameTarget.kind === "note") {
      onEditProjectNote(renameTarget.project.id, renameTarget.note.id, name, renameTarget.note.content);
    } else {
      setTerminalNames((current) => ({ ...current, [renameTarget.command.id]: name }));
    }
    setRenameTarget(null);
    setRenameValue("");
  }

  function renameEditorFor(kind: "flow" | "note" | "terminal" | "section", id: number | string) {
    const targetId = renameTarget?.kind === "flow"
      ? renameTarget.flow.id
      : renameTarget?.kind === "note"
        ? renameTarget.note.id
        : renameTarget?.kind === "terminal"
          ? renameTarget.command.id
          : renameTarget?.kind === "section"
            ? renameTarget.section.id
          : null;
    if (renameTarget?.kind !== kind || targetId !== id) return undefined;
    return {
      value: renameValue,
      onChange: setRenameValue,
      onSubmit: submitRename,
      onCancel: cancelRename,
      isPending: (kind === "flow" && updateFlowMutation.isPending) || (kind === "section" && isMutatingSection),
    };
  }

  useEffect(() => {
    localStorage.setItem(SIDEBAR_VIEW_KEY, activeSidebarView);
  }, [activeSidebarView]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_LAYOUT_KEY, JSON.stringify(sidebarLayout));
  }, [sidebarLayout]);

  useEffect(() => {
    localStorage.setItem(FILE_EXPLORER_SIDEBAR_KEY, JSON.stringify({ secondarySidebarVisible: isSecondarySidebarVisible, fileExplorerVisible: isFileExplorerVisible, fileExplorerWidth }));
  }, [fileExplorerWidth, isFileExplorerVisible, isSecondarySidebarVisible]);

  useEffect(() => { localStorage.setItem("vscodeCommandsExpanded", String(commandsExpanded)); }, [commandsExpanded]);
  useEffect(() => { localStorage.setItem("vscodeNotesExpanded", String(notesExpanded)); }, [notesExpanded]);
  useEffect(() => { localStorage.setItem("vscodeFlowsExpanded", String(flowsExpanded)); }, [flowsExpanded]);

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

  const handleFlowDirtyChange = useCallback((flowId: number, isDirty: boolean) => {
    setFlowDirtyById((current) => current[flowId] === isDirty ? current : { ...current, [flowId]: isDirty });
  }, []);

  function closeTabsNow(tabIds: string[]) {
    const ids = new Set(tabIds);
    if (ids.size === 0) return;
    let nextActiveId = activeTabId;
    setTabs((current) => {
      const activeIndex = current.findIndex((tab) => tab.id === activeTabId);
      const next = current.filter((tab) => !ids.has(tab.id));
      if (ids.has(activeTabId)) {
        nextActiveId = (next.length > 0 ? next[Math.min(Math.max(activeIndex, 0), next.length - 1)] : welcomeTab()).id;
      }
      return next.length > 0 ? next : [welcomeTab()];
    });
    setPinnedTabIds((current) => new Set([...current].filter((id) => !ids.has(id))));
    setFlowDirtyById((current) => Object.fromEntries(Object.entries(current).filter(([flowId]) => !ids.has(`flow:${flowId}`))));
    setActiveTabId(nextActiveId);
  }

  function requestCloseTabs(tabIds: string[]) {
    const ids = [...new Set(tabIds)].filter((id) => id !== "welcome");
    if (ids.length === 0) return;
    const hasUnsavedFlow = tabs.some((tab) => tab.kind === "flow" && ids.includes(tab.id) && flowDirtyById[tab.flowId]);
    if (hasUnsavedFlow) {
      setPendingTabCloseIds(ids);
      return;
    }
    closeTabsNow(ids);
  }

  function closeTab(tabId: string) {
    requestCloseTabs([tabId]);
  }

  function togglePinnedTab(tabId: string) {
    setPinnedTabIds((current) => {
      const next = new Set(current);
      if (next.has(tabId)) next.delete(tabId); else next.add(tabId);
      return next;
    });
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
      toggleSecondarySidebar() {
        setIsSecondarySidebarVisible((current) => !current);
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
      { separator: true },
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
      {
        label: "Add section",
        icon: <ListTree size={13} />,
        onSelect: () => {
          setSectionCreationError(null);
          setSectionDialogProject(project);
        },
      },
    ];
  }

  function getSectionMenuItems(project: Project, section: CommandSection) {
    const isGeneral = section.section.toLowerCase() === "general";
    const isEmpty = section.commands.length === 0;
    return [
      {
        label: "Add command",
        icon: <CopyPlus size={13} />,
        onSelect: () => onAddCommand(project.id, section.section),
      },
      { separator: true },
      {
        label: "Rename section",
        icon: <Pencil size={13} />,
        onSelect: () => beginRename({ kind: "section", project, section }, section.section),
        disabled: isGeneral,
      },
      {
        label: "Delete section",
        icon: <Trash2 size={13} className="text-[var(--vscode-danger)]" />,
        onSelect: () => setSectionToDelete({ project, section }),
        disabled: isGeneral || !isEmpty,
        tone: "danger" as const,
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
      { separator: true },
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
      { separator: true },
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
      { separator: true },
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
        label: "Rename note",
        icon: <Pencil size={13} />,
        onSelect: () => beginRename({ kind: "note", project, note }, noteTitle(note)),
      },
      {
        label: "Edit note",
        icon: <FilePenLine size={13} />,
        onSelect: () => setEditingSidebarNote({ project, note }),
      },
      { separator: true },
      {
        label: "Delete note",
        icon: <Trash2 size={13} className="text-[var(--vscode-danger)]" />,
        onSelect: () => onDeleteProjectNote(project.id, note.id),
        tone: "danger" as const,
      },
    ];
  }

  function getFlowMenuItems(project: Project, flow: ProjectFlow) {
    return [
      {
        label: "Open flow",
        icon: <GitBranch size={13} />,
        onSelect: () => handleOpenFlowTab(project, flow),
      },
      { separator: true },
      {
        label: "Rename flow",
        icon: <Pencil size={13} />,
        onSelect: () => beginRename({ kind: "flow", project, flow }, flow.name),
      },
      {
        label: "Edit flow",
        icon: <FilePenLine size={13} />,
        onSelect: () => setEditingFlow(flow),
      },
      { separator: true },
      {
        label: "Delete flow",
        icon: <Trash2 size={13} className="text-[var(--vscode-danger)]" />,
        onSelect: () => setFlowToDelete(flow),
        tone: "danger" as const,
      },
    ];
  }

  function getTerminalMenuItems(command: ProjectCommand) {
    return [
      {
        label: "Rename terminal",
        icon: <Pencil size={13} />,
        onSelect: () => beginRename({ kind: "terminal", command }, terminalNames[command.id] ?? command.name),
      },
      { separator: true },
      {
        label: "Kill terminal",
        icon: <X size={13} />,
        onSelect: () => onCloseLogTab(command.id),
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

    if (activeTab.kind === "file-view") {
      return <ProjectFileViewer project={tabProject} relativePath={activeTab.relativePath} />;
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
          onAddCommand={(section) => onAddCommand(tabProject.id, section)}
          onAddSection={() => {
            setSectionCreationError(null);
            setSectionDialogProject(tabProject);
          }}
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
        project={tabProject}
        flow={flow}
        commands={commandsByProjectId[tabProject.id] ?? []}
        runs={runs}
        flowRun={flowRuns[flow.id]}
        onRunFlow={onRunFlow}
        onStopFlow={onStopFlow}
        onOpenLogs={handleOpenLogs}
        onDeleted={() => onDeleteFlow(flow)}
        onDirtyChange={handleFlowDirtyChange}
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
                  title={terminalNames[command.id] ?? command.name}
                  icon={<TerminalSquare size={14} />}
                  active={activeLogCommandId === command.id}
                  trailing={runs[command.id]?.status === "running" ? "running" : undefined}
                  onClick={() => {
                    onOpenLogs(command.id);
                    onActiveLogCommandChange(command.id);
                  }}
                  menuItems={getTerminalMenuItems(command)}
                  editTitle={renameEditorFor("terminal", command.id)}
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
                  menuItems={getNoteMenuItems(activeContextProject, note)}
                  editTitle={renameEditorFor("note", note.id)}
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
                  menuItems={getFlowMenuItems(activeContextProject, flow)}
                  editTitle={renameEditorFor("flow", flow.id)}
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
                        { separator: true },
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
                              menuItems={getSectionMenuItems(project, section)}
                              editTitle={renameEditorFor("section", section.id)}
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
                        { separator: true },
                        { label: flowsExpanded ? "Collapse flows" : "Expand flows", icon: flowsExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />, onSelect: () => setFlowsExpanded((current) => !current) },
                      ]}
                    />
                    {flowsExpanded ? (
                      <>
                        <TreeItem title="Open flows view" level={2} active={activeTab.kind === "flows-overview"} onClick={handleOpenFlowsOverview} />
                        {(flowsByProjectId[project.id] ?? []).map((flow) => (
                          <TreeItem key={flow.id} level={2} title={flow.name} icon={<GitBranch size={12} />} active={activeTab.kind === "flow" && activeTab.flowId === flow.id} onClick={() => handleOpenFlowTab(project, flow)} menuItems={getFlowMenuItems(project, flow)} editTitle={renameEditorFor("flow", flow.id)} />
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
                        { separator: true },
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
                            editTitle={renameEditorFor("note", note.id)}
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

      <div className="flex min-h-0 min-w-0 flex-1">
      <Group
        orientation="horizontal"
        groupRef={sidebarGroupRef}
        elementRef={sidebarGroupElementRef}
        defaultLayout={sidebarLayout}
        onLayoutChanged={(layout) =>
          setSidebarLayout({
            sidebar: layout.sidebar ?? DEFAULT_SIDEBAR_LAYOUT.sidebar,
            editor: layout.editor ?? DEFAULT_SIDEBAR_LAYOUT.editor,
          })
        }
        className="min-h-0 min-w-0 flex-1"
      >
        {isSecondarySidebarVisible ? <Panel
          id="sidebar"
          defaultSize={SIDEBAR_DEFAULT_SIZE}
          minSize={SIDEBAR_MIN_SIZE}
          maxSize={SIDEBAR_MAX_SIZE}
          className="min-h-0 min-w-0"
        >
          <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-[var(--vscode-border)] bg-[var(--vscode-sidebar)]">
            <div className="flex items-center justify-between border-b border-[var(--vscode-border)] px-4 py-3">
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
              {activeSidebarView === "explorer" ? (
                <Tooltip content={isFileExplorerVisible ? "Hide file explorer" : "Show file explorer"}>
                  <button type="button" onClick={toggleFileExplorer} className="rounded-[4px] p-1 text-[var(--vscode-icon)] hover:bg-[var(--vscode-list-hover)] hover:text-foreground" aria-label={isFileExplorerVisible ? "Hide file explorer" : "Show file explorer"}>
                    {isFileExplorerVisible ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
                  </button>
                </Tooltip>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{sidebarContent}</div>
          </aside>
        </Panel> : null}

        {isSecondarySidebarVisible ? <Separator className="relative -mx-1 w-2 cursor-col-resize bg-transparent before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-[var(--vscode-border)] before:transition-colors hover:before:bg-primary" /> : null}

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
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setTabContextMenu({ tabId: tab.id, x: event.clientX, y: event.clientY });
                      }}
                    >
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 truncate text-left" onClick={() => setActiveTabId(tab.id)}>
                        <span className="truncate">{tab.title}</span>
                        {tab.kind === "flow" && flowDirtyById[tab.flowId] ? <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--vscode-foreground)]" aria-label="Unsaved changes" /> : null}
                        {pinnedTabIds.has(tab.id) ? <Pin size={11} className="shrink-0 text-[var(--vscode-icon)]" aria-label="Pinned" /> : null}
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
      {activeSidebarView === "explorer" && isFileExplorerVisible ? (
        <aside className="relative flex shrink-0 flex-col border-l border-[var(--vscode-border)] bg-[var(--vscode-sidebar)]" style={{ width: fileExplorerWidth }}>
          <div onPointerDown={startFileExplorerResize} className="absolute inset-y-0 -left-1 z-20 w-3 cursor-col-resize before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent hover:before:bg-primary" aria-label="Resize file explorer" />
          <div className="flex h-[45px] items-center justify-between border-b border-[var(--vscode-border)] px-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--vscode-foreground)]/58">Files</span>
            <button type="button" onClick={toggleFileExplorer} className="rounded-[4px] p-1 text-[var(--vscode-icon)] hover:bg-[var(--vscode-list-hover)] hover:text-foreground" aria-label="Close file explorer"><X size={15} /></button>
          </div>
          <ProjectFileExplorer project={activeContextProject} onView={(relativePath) => {
            if (activeContextProject) openTab(fileViewTab(activeContextProject, relativePath));
          }} onOpenTerminal={(relativeDirectoryPath) => {
            if (activeContextProject) onOpenAdHocInteractiveTerminal(activeContextProject, defaultInteractiveTerminalKind, relativeDirectoryPath ? `${activeContextProject.path}/${relativeDirectoryPath}` : activeContextProject.path);
          }} />
        </aside>
      ) : null}
      </div>
      </main>
      {tabContextMenu ? (() => {
        const tab = tabs.find((item) => item.id === tabContextMenu.tabId);
        if (!tab) return null;
        const tabIndex = tabs.findIndex((item) => item.id === tab.id);
        const closeOthers = tabs.filter((item) => item.id !== tab.id && item.id !== "welcome" && !pinnedTabIds.has(item.id)).map((item) => item.id);
        const closeToRight = tabs.slice(tabIndex + 1).filter((item) => item.id !== "welcome" && !pinnedTabIds.has(item.id)).map((item) => item.id);
        const closeAll = tabs.filter((item) => item.id !== "welcome" && !pinnedTabIds.has(item.id)).map((item) => item.id);
        return <TabContextMenu
          x={tabContextMenu.x}
          y={tabContextMenu.y}
          onClose={() => setTabContextMenu(null)}
          items={[
            { label: "Close", icon: <X size={13} />, onSelect: () => closeTab(tab.id), disabled: tab.kind === "welcome" },
            { label: "Close Others", icon: <X size={13} />, onSelect: () => requestCloseTabs(closeOthers), disabled: closeOthers.length === 0 },
            { label: "Close to the Right", icon: <X size={13} />, onSelect: () => requestCloseTabs(closeToRight), disabled: closeToRight.length === 0 },
            { label: "Close All", icon: <X size={13} />, onSelect: () => requestCloseTabs(closeAll), disabled: closeAll.length === 0 },
            { separator: true },
            { label: pinnedTabIds.has(tab.id) ? "Unpin" : "Pin", icon: pinnedTabIds.has(tab.id) ? <PinOff size={13} /> : <Pin size={13} />, onSelect: () => togglePinnedTab(tab.id) },
          ]}
        />;
      })() : null}
      <CommandSectionDialog
        open={sectionDialogProject !== null}
        projectName={sectionDialogProject?.name ?? null}
        isPending={isMutatingSection}
        error={sectionCreationError}
        onOpenChange={(open) => {
          if (!open && !isMutatingSection) {
            setSectionDialogProject(null);
            setSectionCreationError(null);
          }
        }}
        onSubmit={(name) => {
          if (!sectionDialogProject) return;
          setSectionCreationError(null);
          void onAddSection(sectionDialogProject.id, name)
            .then(() => setSectionDialogProject(null))
            .catch((error: unknown) => {
              setSectionCreationError(error instanceof Error ? error.message : "Unable to create section.");
            });
        }}
      />
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
      <FlowFormDialog
        mode="edit"
        open={editingFlow !== null}
        projectName={editingFlow ? findProjectById(projects, editingFlow.project_id)?.name ?? null : null}
        flowName={editingFlow?.name}
        isPending={updateFlowMutation.isPending}
        error={updateFlowMutation.error instanceof Error ? updateFlowMutation.error.message : null}
        onOpenChange={(open) => {
          if (!open && !updateFlowMutation.isPending) setEditingFlow(null);
        }}
        onSubmit={(name) => {
          if (editingFlow) updateFlowMutation.mutate({ id: editingFlow.id, name });
        }}
      />
      <ProjectNoteDialog
        mode="edit"
        open={editingSidebarNote !== null}
        onOpenChange={(open) => { if (!open) setEditingSidebarNote(null); }}
        projectName={editingSidebarNote?.project.name ?? "this project"}
        value={editingSidebarNote ? { title: editingSidebarNote.note.title, content: editingSidebarNote.note.content } : { title: "", content: "" }}
        onValueChange={(field, value) => {
          setEditingSidebarNote((current) => current ? { ...current, note: { ...current.note, [field]: value } } : current);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!editingSidebarNote || !editingSidebarNote.note.title.trim() || !editingSidebarNote.note.content.trim()) return;
          onEditProjectNote(editingSidebarNote.project.id, editingSidebarNote.note.id, editingSidebarNote.note.title, editingSidebarNote.note.content);
          setEditingSidebarNote(null);
        }}
        isSaving={isSavingNotes}
      />
      <ConfirmDialog
        open={flowToDelete !== null}
        onOpenChange={(open) => { if (!open) setFlowToDelete(null); }}
        title="Delete flow"
        description={`Delete flow “${flowToDelete?.name ?? ""}”? This cannot be undone.`}
        confirmLabel="Delete flow"
        onConfirm={() => { if (flowToDelete) onDeleteFlow(flowToDelete); }}
      />
      <ConfirmDialog
        open={sectionToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !isMutatingSection) setSectionToDelete(null);
        }}
        title="Delete section"
        description={`Delete the empty section “${sectionToDelete?.section.section ?? ""}”?`}
        confirmLabel="Delete section"
        onConfirm={() => {
          if (!sectionToDelete) return;
          void onDeleteSection(sectionToDelete.project.id, sectionToDelete.section.id)
            .then(() => setSectionToDelete(null))
            .catch(() => undefined);
        }}
      />
      <ConfirmDialog
        open={pendingTabCloseIds !== null}
        onOpenChange={(open) => { if (!open) setPendingTabCloseIds(null); }}
        title="Discard unsaved flow changes?"
        description="One or more flow tabs have changes that have not been saved. Closing them will discard those changes."
        confirmLabel="Discard and close"
        onConfirm={() => {
          if (pendingTabCloseIds) closeTabsNow(pendingTabCloseIds);
          setPendingTabCloseIds(null);
        }}
      />
    </>
  );
});
