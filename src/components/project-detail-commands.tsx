import type { FormEvent, RefObject } from "react";
import { Check, Pencil, Plus, Terminal, Trash2, X } from "lucide-react";
import type { ProjectCommand } from "../lib/api";
import { DEFAULT_SECTION } from "../lib/command-utils";
import { CommandCard, LogLine, LogPanel, RunState } from "./project-runtime";
import type { CommandSection } from "./project-detail-types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";

export function ProjectDetailCommands({
  commands,
  commandSections,
  runs,
  logs,
  openLogCommandIds,
  activeLogCommandId,
  onActiveLogCommandChange,
  onClearLogs,
  onCloseLogTab,
  theme,
  showLogsTimestamp,
  showStreamName,
  renamingSection,
  renameSectionValue,
  onRenameSectionValueChange,
  onStartRenameSection,
  onCancelRenameSection,
  onRenameSection,
  onDeleteCommand,
  onEditCommand,
  onKillPorts,
  onRestartCommand,
  onRunCommand,
  onStopCommand,
  stoppingRunIds,
  restartPendingCommandIds,
  scanningCommandId,
  onOpenLogs,
  onDeleteSection,
  isAddingSection,
  newSectionName,
  onNewSectionNameChange,
  addSectionInputRef,
  onAddSectionSubmit,
  onStartAddSection,
  onCancelAddSection,
  showEmptyCommandsState,
  onAddCommand,
}: {
  commands: ProjectCommand[];
  commandSections: CommandSection[];
  runs: Record<number, RunState>;
  logs: LogLine[];
  openLogCommandIds: number[];
  activeLogCommandId: number | null;
  onActiveLogCommandChange: (commandId: number) => void;
  onClearLogs: (commandId: number) => void;
  onCloseLogTab: (commandId: number) => void;
  theme: "light" | "dark";
  showLogsTimestamp: boolean;
  showStreamName: boolean;
  renamingSection: string | null;
  renameSectionValue: string;
  onRenameSectionValueChange: (value: string) => void;
  onStartRenameSection: (section: string) => void;
  onCancelRenameSection: () => void;
  onRenameSection: (section: string, nextName: string) => void | Promise<void>;
  onDeleteCommand: (command: ProjectCommand) => void;
  onEditCommand: (command: ProjectCommand) => void;
  onKillPorts: (command: ProjectCommand) => void;
  onRestartCommand: (command: ProjectCommand) => void;
  onRunCommand: (command: ProjectCommand) => void;
  onStopCommand: (command: ProjectCommand) => void;
  stoppingRunIds: Set<number>;
  restartPendingCommandIds: number[];
  scanningCommandId: number | null;
  onOpenLogs: (commandId: number) => void;
  onDeleteSection: (section: string) => void;
  isAddingSection: boolean;
  newSectionName: string;
  onNewSectionNameChange: (value: string) => void;
  addSectionInputRef: RefObject<HTMLInputElement | null>;
  onAddSectionSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onStartAddSection: () => void;
  onCancelAddSection: () => void;
  showEmptyCommandsState: boolean;
  onAddCommand: (section?: string) => void;
}) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
      <section className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        {commandSections.map(({ section, commands: sectionCommands }) => (
          <div className="rounded-[10px] border border-app-border bg-[var(--command-section-bg)] p-2.5" key={section}>
            <div className="group mb-2 flex w-full items-center justify-between gap-2">
              {renamingSection === section ? (
                <form
                  className="flex items-center gap-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onRenameSection(section, renameSectionValue);
                  }}
                >
                  <Input
                    type="text"
                    className="h-7 max-w-[150px] px-2 text-[12.5px]"
                    value={renameSectionValue}
                    onChange={(event) => onRenameSectionValueChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        onCancelRenameSection();
                      }
                    }}
                    autoFocus
                  />
                  <Button type="submit" size="icon" variant="ghost" className="h-6 w-6 p-0" title="Save">
                    <Check size={14} />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    onClick={onCancelRenameSection}
                    title="Cancel"
                  >
                    <X size={14} />
                  </Button>
                </form>
              ) : (
                <div className="flex min-w-0 items-center gap-2">
                  <h3>{section}</h3>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => onStartRenameSection(section)}
                    title="Rename section"
                  >
                    <Pencil size={12} />
                  </Button>
                </div>
              )}
              <Badge variant="muted">{sectionCommands.length}</Badge>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
              {sectionCommands.map((command) => (
                <CommandCard
                  command={command}
                  key={command.id}
                  onDelete={() => onDeleteCommand(command)}
                  onEdit={() => onEditCommand(command)}
                  onKillPorts={() => onKillPorts(command)}
                  onRestart={() => onRestartCommand(command)}
                  onRun={() => onRunCommand(command)}
                  onStop={() => onStopCommand(command)}
                  run={runs[command.id]}
                  isStopping={Boolean(runs[command.id] && stoppingRunIds.has(runs[command.id]!.runId))}
                  isRestarting={restartPendingCommandIds.includes(command.id)}
                  isScanningPorts={scanningCommandId === command.id}
                  onOpenLogs={() => onOpenLogs(command.id)}
                />
              ))}
              {sectionCommands.length === 0 && (
                <Card className="col-span-full flex flex-wrap items-center justify-between gap-2.5 rounded-[10px] border border-dashed border-app-border bg-transparent p-2.5 text-muted-foreground shadow-none">
                  <Terminal size={24} className="shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <h4 className="text-[12.5px] font-semibold text-app-title">No commands in this section</h4>
                    <p className="text-[11.5px] text-muted-foreground">Add a command to run in this section.</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Button size="sm" onClick={() => onAddCommand(section)}>
                      <Plus size={14} /> Add command
                    </Button>
                    {section !== DEFAULT_SECTION && (
                      <Button size="sm" variant="ghost" onClick={() => onDeleteSection(section)}>
                        <Trash2 size={14} /> Delete section
                      </Button>
                    )}
                  </div>
                </Card>
              )}
            </div>
          </div>
        ))}

        <div className="w-full py-0.5">
          <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[10px] border border-dashed border-primary/30 bg-primary/[0.03] p-2.5">
            <div className="flex min-w-0 flex-col gap-0.5">
              <strong className="text-[12.5px] text-app-title">Add another section</strong>
              <span>Group related commands into compact desktop lanes.</span>
            </div>
            {isAddingSection ? (
              <form className="flex w-full max-w-[460px] flex-wrap items-center gap-2" onSubmit={onAddSectionSubmit}>
                <Input
                  ref={addSectionInputRef}
                  placeholder="New section name..."
                  value={newSectionName}
                  onChange={(event) => onNewSectionNameChange(event.target.value)}
                  className="min-w-[180px] flex-1"
                />
                <div className="flex items-center gap-1.5">
                  <Button type="submit" size="sm">
                    Add
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={onCancelAddSection}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <Button variant="outline" className="border-primary/30 text-primary hover:bg-primary/10" onClick={onStartAddSection}>
                <Plus size={16} />
                Add Section
              </Button>
            )}
          </div>
        </div>

        {showEmptyCommandsState && (
          <Card className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-app-border bg-card/20 p-4 text-center">
            <Terminal size={28} />
            <div className="space-y-1">
              <h3>No commands yet</h3>
              <p>Add commands like frontend dev servers, API workers, tests, or build steps.</p>
            </div>
            <Button onClick={() => onAddCommand()}>
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
        onActiveCommandChange={onActiveLogCommandChange}
        onClear={onClearLogs}
        onCloseTab={onCloseLogTab}
        runs={runs}
        theme={theme}
        showLogsTimestamp={showLogsTimestamp}
        showStreamName={showStreamName}
      />
    </div>
  );
}


