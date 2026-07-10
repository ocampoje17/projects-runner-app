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
    <div className="content-grid">
      <section className="command-sections">
        {commandSections.map(({ section, commands: sectionCommands }) => (
          <div className="command-section" key={section}>
            <div className="section-header">
              {renamingSection === section ? (
                <form
                  className="rename-section-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onRenameSection(section, renameSectionValue);
                  }}
                >
                  <Input
                    type="text"
                    className="rename-section-input"
                    value={renameSectionValue}
                    onChange={(event) => onRenameSectionValueChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        onCancelRenameSection();
                      }
                    }}
                    autoFocus
                  />
                  <Button type="submit" size="icon" variant="ghost" className="rename-save-btn" title="Save">
                    <Check size={14} />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="rename-cancel-btn"
                    onClick={onCancelRenameSection}
                    title="Cancel"
                  >
                    <X size={14} />
                  </Button>
                </form>
              ) : (
                <div className="section-title-row">
                  <h3>{section}</h3>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="rename-section-btn"
                    onClick={() => onStartRenameSection(section)}
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
                <Card className="empty-section-card">
                  <Terminal size={24} className="empty-section-icon" />
                  <div className="empty-section-info">
                    <h4>No commands in this section</h4>
                    <p>Add a command to run in this section.</p>
                  </div>
                  <div className="empty-section-actions">
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

        <div className="add-section-wrapper">
          <div className="add-section-shell">
            <div className="add-section-copy">
              <strong>Add another section</strong>
              <span>Group related commands into compact desktop lanes.</span>
            </div>
            {isAddingSection ? (
              <form className="add-section-form" onSubmit={onAddSectionSubmit}>
                <Input
                  ref={addSectionInputRef}
                  placeholder="New section name..."
                  value={newSectionName}
                  onChange={(event) => onNewSectionNameChange(event.target.value)}
                  className="add-section-input"
                />
                <div className="add-section-actions">
                  <Button type="submit" size="sm">
                    Add
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={onCancelAddSection}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <Button variant="outline" className="add-section-button" onClick={onStartAddSection}>
                <Plus size={16} />
                Add Section
              </Button>
            )}
          </div>
        </div>

        {showEmptyCommandsState && (
          <Card className="empty-card workspace-empty-card">
            <Terminal size={28} />
            <div className="empty-state-copy">
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
