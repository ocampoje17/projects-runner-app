import Fuse from "fuse.js";
import {
  Command,
  CornerDownLeft,
  FileCode2,
  FolderKanban,
  GitBranch,
  Search,
  StickyNote,
} from "lucide-react";
import {
  forwardRef,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { EntityAvatar } from "./entity-avatar";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import type {
  TitlebarCommandSearchItem,
  TitlebarFlowSearchItem,
  TitlebarNoteSearchItem,
  TitlebarProjectSearchItem,
  TitlebarSearchCollections,
  TitlebarSearchItem,
} from "../lib/titlebar-search";
import { cn } from "@/lib/utils";

const PROJECT_RESULT_LIMIT = 6;
const COMMAND_RESULT_LIMIT = 8;
const NOTE_RESULT_LIMIT = 8;
const FLOW_RESULT_LIMIT = 8;

type VisibleSection = {
  key: "projects" | "commands" | "notes" | "flows";
  title: string;
  items: TitlebarSearchItem[];
};

export type TitlebarSearchHandle = {
  focus: () => void;
};

export const TitlebarSearch = forwardRef<
  TitlebarSearchHandle,
  {
    collections: TitlebarSearchCollections;
    onSelect: (item: TitlebarSearchItem) => void;
  }
>(function TitlebarSearch({ collections, onSelect }, ref) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim();

  useImperativeHandle(ref, () => ({
    focus() {
      inputRef.current?.focus();
      inputRef.current?.select();
      setIsOpen(true);
    },
  }));

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setIsOpen(true);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleShortcut);
    };
  }, []);

  const projectFuse = useMemo(
    () =>
      new Fuse(collections.projects, {
        includeScore: true,
        threshold: 0.34,
        ignoreLocation: true,
        keys: [
          { name: "title", weight: 0.7 },
          { name: "path", weight: 0.2 },
          { name: "description", weight: 0.1 },
        ],
      }),
    [collections.projects],
  );

  const commandFuse = useMemo(
    () =>
      new Fuse(collections.commands, {
        includeScore: true,
        threshold: 0.36,
        ignoreLocation: true,
        keys: [
          { name: "title", weight: 0.55 },
          { name: "projectName", weight: 0.15 },
          { name: "section", weight: 0.1 },
          { name: "script", weight: 0.2 },
        ],
      }),
    [collections.commands],
  );

  const noteFuse = useMemo(
    () =>
      new Fuse(collections.notes, {
        includeScore: true,
        threshold: 0.38,
        ignoreLocation: true,
        keys: [
          { name: "title", weight: 0.35 },
          { name: "projectName", weight: 0.1 },
          { name: "content", weight: 0.55 },
        ],
      }),
    [collections.notes],
  );

  const flowFuse = useMemo(
    () => new Fuse(collections.flows, { includeScore: true, threshold: 0.36, ignoreLocation: true, keys: [
      { name: "title", weight: 0.7 }, { name: "projectName", weight: 0.3 },
    ] }),
    [collections.flows],
  );

  const sections = useMemo<VisibleSection[]>(() => {
    if (!normalizedQuery) {
      return [];
    }

    const nextSections: VisibleSection[] = [
      {
        key: "projects",
        title: "Projects",
        items: projectFuse.search(normalizedQuery).map((result) => result.item).slice(0, PROJECT_RESULT_LIMIT),
      },
      {
        key: "commands",
        title: "Commands",
        items: commandFuse.search(normalizedQuery).map((result) => result.item).slice(0, COMMAND_RESULT_LIMIT),
      },
      {
        key: "notes",
        title: "Notes",
        items: noteFuse.search(normalizedQuery).map((result) => result.item).slice(0, NOTE_RESULT_LIMIT),
      },
      {
        key: "flows",
        title: "Flows",
        items: flowFuse.search(normalizedQuery).map((result) => result.item).slice(0, FLOW_RESULT_LIMIT),
      },
    ];

    return nextSections.filter((section) => section.items.length > 0);
  }, [commandFuse, flowFuse, noteFuse, normalizedQuery, projectFuse]);

  const flatResults = useMemo(() => sections.flatMap((section) => section.items), [sections]);

  useEffect(() => {
    if (flatResults.length === 0) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((current) => Math.min(current, flatResults.length - 1));
  }, [flatResults]);

  function handleSelect(item: TitlebarSearchItem) {
    onSelect(item);
    setQuery("");
    setIsOpen(false);
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => (flatResults.length === 0 ? 0 : (current + 1) % flatResults.length));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => (flatResults.length === 0 ? 0 : (current - 1 + flatResults.length) % flatResults.length));
      return;
    }

    if (event.key === "Enter") {
      if (!isOpen || flatResults.length === 0) {
        return;
      }
      event.preventDefault();
      handleSelect(flatResults[activeIndex] ?? flatResults[0]!);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      if (query) {
        setQuery("");
        return;
      }
      setIsOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div
      ref={rootRef}
      data-titlebar-interactive="true"
      className="titlebar-search relative z-20 flex w-full max-w-[640px] flex-1 items-center"
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
    >
      <Search
        size={13}
        className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-[var(--vscode-foreground)]/62"
      />
      <Input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => {
          setIsOpen(true);
        }}
        onKeyDown={handleInputKeyDown}
        placeholder="Search projects, commands, notes, and flows"
        className="titlebar-search-input h-8 rounded-[8px] border-[var(--vscode-command-center-border)] bg-[var(--vscode-command-center-bg)] pl-8 pr-16 text-[12px] hover:bg-[var(--vscode-command-center-hover)] focus-visible:bg-[var(--vscode-command-center-active)]"
      />
      <div className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 text-[10.5px] text-[var(--vscode-foreground)]/58">
        <kbd className="rounded-[4px] border border-[var(--vscode-border)] bg-black/10 px-1.5 py-0.5 font-sans text-[10px]">Ctrl</kbd>
        <span>+</span>
        <kbd className="rounded-[4px] border border-[var(--vscode-border)] bg-black/10 px-1.5 py-0.5 font-sans text-[10px]">P</kbd>
      </div>

      {isOpen ? (
        <div className="titlebar-search-panel absolute left-0 top-[calc(100%+8px)] w-full overflow-hidden rounded-[10px] border border-[var(--vscode-command-center-border)] bg-[var(--vscode-panel)] shadow-[0_24px_60px_rgb(0_0_0_/_0.45)]">
          {!normalizedQuery ? (
            <div className="px-4 py-4 text-[12px] text-[var(--vscode-foreground)]/74">
              <div className="font-normal text-foreground">Type to search across your workspace</div>
              <div className="mt-1">Projects, commands, notes, and saved flows can be opened from here.</div>
            </div>
          ) : sections.length === 0 ? (
            <div className="px-4 py-4 text-[12px] text-[var(--vscode-foreground)]/74">
              <div className="font-normal text-foreground">No matches found</div>
              <div className="mt-1">Try a project, command, note, or flow name.</div>
            </div>
          ) : (
            <div className="max-h-[480px] overflow-y-auto py-2">
              {sections.map((section) => {
                let runningIndex = -1;
                return (
                  <div key={section.key} className="pb-1">
                    <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--vscode-foreground)]/52">
                      {section.title}
                    </div>
                    {section.items.map((item) => {
                      runningIndex = flatResults.findIndex((result) => result.id === item.id);
                      return (
                        <SearchResultRow
                          key={item.id}
                          item={item}
                          active={runningIndex === activeIndex}
                          onMouseEnter={() => setActiveIndex(runningIndex)}
                          onSelect={() => handleSelect(item)}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
});

function SearchResultRow({
  item,
  active,
  onMouseEnter,
  onSelect,
}: {
  item: TitlebarSearchItem;
  active: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "mx-2 flex w-[calc(100%-16px)] items-start gap-3 rounded-[8px] px-3 py-2.5 text-left transition-colors",
        active
          ? "bg-[var(--vscode-command-center-active)] text-foreground"
          : "text-[var(--vscode-foreground)] hover:bg-[var(--vscode-command-center-hover)] hover:text-foreground",
      )}
      onMouseEnter={onMouseEnter}
      onClick={onSelect}
    >
      <div className="mt-0.5 shrink-0">
        {item.kind === "project" ? (
          <EntityAvatar name={item.title} path={item.avatarPath} />
        ) : item.kind === "command" ? (
          <div className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] text-[var(--vscode-status)]">
            <Command size={15} />
          </div>
        ) : item.kind === "flow" ? (
          <div className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] text-[var(--success-color)]"><GitBranch size={15} /></div>
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[var(--vscode-border)] bg-[var(--vscode-editor)] text-[var(--primary-color)]">
            <StickyNote size={15} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {item.kind === "project" ? <ProjectResultContent item={item} /> : null}
        {item.kind === "command" ? <CommandResultContent item={item} /> : null}
        {item.kind === "note" ? <NoteResultContent item={item} /> : null}
        {item.kind === "flow" ? <FlowResultContent item={item} /> : null}
      </div>
      <div className="mt-0.5 hidden shrink-0 items-center gap-1 text-[11px] text-[var(--vscode-foreground)]/54 md:flex">
        <CornerDownLeft size={12} />
        <span>Open</span>
      </div>
    </button>
  );
}

function FlowResultContent({ item }: { item: TitlebarFlowSearchItem }) {
  return <><div className="flex items-center gap-2"><span className="truncate text-[12px] font-normal text-foreground">{item.title}</span><Badge variant="muted">Flow</Badge></div><div className="mt-1 flex items-center gap-1 text-[11px] text-[var(--vscode-foreground)]/66"><FolderKanban size={12} /><span className="truncate">{item.projectName}</span></div><div className="mt-1 text-[11px] text-[var(--vscode-foreground)]/72">{item.nodeCount} command nodes</div></>;
}

function ProjectResultContent({ item }: { item: TitlebarProjectSearchItem }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="truncate text-[12px] font-normal text-foreground">{item.title}</span>
        <Badge variant="muted">Project</Badge>
      </div>
      <div className="mt-1 truncate font-mono text-[11px] text-[var(--vscode-foreground)]/64">{item.path}</div>
      {item.description ? <div className="mt-1 line-clamp-2 text-[11.5px] text-[var(--vscode-foreground)]/74">{item.description}</div> : null}
    </>
  );
}

function CommandResultContent({ item }: { item: TitlebarCommandSearchItem }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="truncate text-[12px] font-normal text-foreground">{item.title}</span>
        <Badge variant="muted">Command</Badge>
        {item.section ? <Badge variant="default">{item.section}</Badge> : null}
      </div>
      <div className="mt-1 truncate text-[11px] text-[var(--vscode-foreground)]/66">{item.projectName}</div>
      <div className="mt-1 flex items-start gap-1.5 font-mono text-[11px] text-[var(--vscode-foreground)]/72">
        <FileCode2 size={12} className="mt-0.5 shrink-0" />
        <span className="line-clamp-2 break-all">{item.script}</span>
      </div>
    </>
  );
}

function NoteResultContent({ item }: { item: TitlebarNoteSearchItem }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="truncate text-[12px] font-normal text-foreground">{item.title}</span>
        <Badge variant="muted">Note</Badge>
        {item.pinned ? <Badge variant="default">Pinned</Badge> : null}
        {item.hidden ? <Badge variant="default">Hidden</Badge> : null}
      </div>
      <div className="mt-1 flex items-center gap-1 text-[11px] text-[var(--vscode-foreground)]/66">
        <FolderKanban size={12} className="shrink-0" />
        <span className="truncate">{item.projectName}</span>
      </div>
      <div className="mt-1 line-clamp-2 text-[11.5px] text-[var(--vscode-foreground)]/74">{item.excerpt || item.content}</div>
    </>
  );
}
