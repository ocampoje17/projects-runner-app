import type { FormEvent, RefObject } from "react";
import type { Project, ProjectCommand } from "../lib/api";
import type { LogLine, RunState } from "./project-runtime";
import { ProjectDetailCommands } from "./project-detail-commands";
import { ProjectDetailNotes } from "./project-detail-notes";
import type { CommandSection, ProjectNote } from "./project-detail-types";
import { Badge } from "./ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

export interface ProjectDetailProps {
  selectedProject: Project;
  projectTab: "commands" | "notes";
  onProjectTabChange: (value: "commands" | "notes") => void;
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
  sortedProjectNotes: ProjectNote[];
  noteVisibility: Record<string, boolean>;
  newProjectNote: string;
  onNewProjectNoteChange: (value: string) => void;
  onAddProjectNote: () => void;
  onUpdateProjectNote: (noteId: string, content: string) => void;
  onSaveProjectNote: (noteId: string) => void;
  onTogglePinnedProjectNote: (noteId: string) => void;
  onToggleProjectNoteVisibility: (noteId: string) => void;
  onDeleteProjectNote: (noteId: string) => void;
  isSavingNotes: boolean;
}

export function ProjectDetail({
  selectedProject,
  projectTab,
  onProjectTabChange,
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
  sortedProjectNotes,
  noteVisibility,
  newProjectNote,
  onNewProjectNoteChange,
  onAddProjectNote,
  onUpdateProjectNote,
  onSaveProjectNote,
  onTogglePinnedProjectNote,
  onToggleProjectNoteVisibility,
  onDeleteProjectNote,
  isSavingNotes,
}: ProjectDetailProps) {
  return (
    <Tabs
      className="project-detail-tabs flex min-h-0 flex-1 flex-col"
      value={projectTab}
      onValueChange={(value) => onProjectTabChange(value as "commands" | "notes")}
    >
      <div className="project-detail-tabs-bar mb-3 flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="commands">Commands</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>
        <div className="project-tab-meta flex items-center gap-1.5">
          <Badge variant="muted">{commands.length} commands</Badge>
          <Badge variant="muted">{sortedProjectNotes.length} notes</Badge>
        </div>
      </div>

      <TabsContent value="commands" className="project-detail-tab-content">
        <ProjectDetailCommands
          commands={commands}
          commandSections={commandSections}
          runs={runs}
          logs={logs}
          openLogCommandIds={openLogCommandIds}
          activeLogCommandId={activeLogCommandId}
          onActiveLogCommandChange={onActiveLogCommandChange}
          onClearLogs={onClearLogs}
          onCloseLogTab={onCloseLogTab}
          theme={theme}
          showLogsTimestamp={showLogsTimestamp}
          showStreamName={showStreamName}
          renamingSection={renamingSection}
          renameSectionValue={renameSectionValue}
          onRenameSectionValueChange={onRenameSectionValueChange}
          onStartRenameSection={onStartRenameSection}
          onCancelRenameSection={onCancelRenameSection}
          onRenameSection={onRenameSection}
          onDeleteCommand={onDeleteCommand}
          onEditCommand={onEditCommand}
          onKillPorts={onKillPorts}
          onRestartCommand={onRestartCommand}
          onRunCommand={onRunCommand}
          onStopCommand={onStopCommand}
          stoppingRunIds={stoppingRunIds}
          restartPendingCommandIds={restartPendingCommandIds}
          scanningCommandId={scanningCommandId}
          onOpenLogs={onOpenLogs}
          onDeleteSection={onDeleteSection}
          isAddingSection={isAddingSection}
          newSectionName={newSectionName}
          onNewSectionNameChange={onNewSectionNameChange}
          addSectionInputRef={addSectionInputRef}
          onAddSectionSubmit={onAddSectionSubmit}
          onStartAddSection={onStartAddSection}
          onCancelAddSection={onCancelAddSection}
          showEmptyCommandsState={showEmptyCommandsState}
          onAddCommand={onAddCommand}
        />
      </TabsContent>

      <TabsContent value="notes" className="project-detail-tab-content">
        <ProjectDetailNotes
          selectedProject={selectedProject}
          sortedProjectNotes={sortedProjectNotes}
          noteVisibility={noteVisibility}
          newProjectNote={newProjectNote}
          onNewProjectNoteChange={onNewProjectNoteChange}
          onAddProjectNote={onAddProjectNote}
          onUpdateProjectNote={onUpdateProjectNote}
          onSaveProjectNote={onSaveProjectNote}
          onTogglePinnedProjectNote={onTogglePinnedProjectNote}
          onToggleProjectNoteVisibility={onToggleProjectNoteVisibility}
          onDeleteProjectNote={onDeleteProjectNote}
          isSavingNotes={isSavingNotes}
        />
      </TabsContent>
    </Tabs>
  );
}

