import { FileInput, FolderOpen, Pencil, Plus, Settings, Share2, Terminal } from "lucide-react";
import appIcon from "../assets/app-icon.png";
import type { Project } from "../lib/api";
import { EntityAvatar } from "./entity-avatar";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

export interface ProjectsSidebarProps {
  projects: Project[];
  selectedProjectId: number | null;
  settingsOpen: boolean;
  onAddProject: () => void;
  onImportProject: () => void;
  onOpenSettings: () => void;
  onSelectProject: (projectId: number) => void;
}

export function ProjectsSidebar({
  projects,
  selectedProjectId,
  settingsOpen,
  onAddProject,
  onImportProject,
  onOpenSettings,
  onSelectProject,
}: ProjectsSidebarProps) {
  return (
    <aside className="app-sidebar flex h-full min-w-0 flex-col border-r border-app-border bg-sidebar">
      <div className="flex items-center gap-2.5 border-b border-app-border px-3 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <img className="h-8 w-8 rounded-[8px] border border-white/10 object-cover shadow-sm" src={appIcon} alt="" />
          <div className="min-w-0">
            <h1 className="truncate text-[14px] font-semibold text-app-title">Projects Runner</h1>
            <p className="text-[11px] text-muted-foreground">{projects.length} projects</p>
          </div>
        </div>
      </div>

      <div className="flex gap-1.5 border-b border-app-border px-3 py-2.5">
        <Button className="flex-1" onClick={onAddProject}>
          <Plus size={15} />
          Add Project
        </Button>
        <Button className="flex-1" variant="outline" onClick={onImportProject}>
          <FileInput size={15} />
          Import .prd
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2.5">
        {projects.map((project) => (
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "grid h-auto min-h-10 w-full grid-cols-[32px_minmax(0,1fr)] items-center justify-start gap-2 rounded-[8px] border border-transparent px-1.5 py-1.5 text-left text-muted-foreground hover:bg-muted hover:text-app-title",
              selectedProjectId === project.id && "border-primary/30 bg-primary/10 text-app-title",
            )}
            key={project.id}
            onClick={() => onSelectProject(project.id)}
          >
            <EntityAvatar name={project.name} path={project.avatar_path} />
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-[12.5px] font-semibold">{project.name}</strong>
            </span>
          </Button>
        ))}
        {projects.length === 0 && (
          <p className="px-2 py-3 text-center text-[12px] text-muted-foreground">
            Create your first project to start running commands.
          </p>
        )}
      </div>

      <div className="border-t border-app-border p-2">
        <Button className="w-full justify-start" variant={settingsOpen ? "secondary" : "ghost"} onClick={onOpenSettings}>
          <Settings size={16} />
          Settings
        </Button>
      </div>
    </aside>
  );
}

export interface ProjectWorkspaceHeaderProps {
  selectedProject: Project;
  onOpenExplorer: () => void;
  onOpenTerminal: () => void;
  onShareProject: () => void;
  onEditProject: () => void;
  onAddCommand: () => void;
}

export function ProjectWorkspaceHeader({
  selectedProject,
  onOpenExplorer,
  onOpenTerminal,
  onShareProject,
  onEditProject,
  onAddCommand,
}: ProjectWorkspaceHeaderProps) {
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-2.5 border-b border-app-border bg-workspace px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <EntityAvatar name={selectedProject.name} path={selectedProject.avatar_path} />
          <div className="min-w-0">
            <h2 className="truncate text-[18px] font-semibold text-app-title">{selectedProject.name}</h2>
            <p className="truncate text-[12px] text-muted-foreground">{selectedProject.path}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon" onClick={onOpenExplorer} title="Show in Explorer">
              <FolderOpen size={16} />
            </Button>
            <Button variant="outline" size="icon" onClick={onOpenTerminal} title="Open in External Terminal">
              <Terminal size={16} />
            </Button>
            <Button variant="outline" size="icon" onClick={onShareProject} title="Share Project">
              <Share2 size={16} />
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" onClick={onEditProject}>
              <Pencil size={16} />
              Edit
            </Button>
            <Button onClick={onAddCommand}>
              <Plus size={16} />
              Add command
            </Button>
          </div>
        </div>
      </header>
      {selectedProject.description ? (
        <p className="px-3 pt-2 text-[12.5px] text-muted-foreground">{selectedProject.description}</p>
      ) : null}
    </>
  );
}

export interface WelcomeWorkspaceProps {
  onAddProject: () => void;
  onImportProject: () => void;
}

export function WelcomeWorkspace({ onAddProject, onImportProject }: WelcomeWorkspaceProps) {
  return (
    <div className="mx-auto flex h-full max-w-[520px] flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <img className="h-16 w-16 rounded-[14px] border border-app-border object-cover shadow-md" src={appIcon} alt="" />
      <div className="space-y-2">
        <h2 className="text-[20px] font-semibold text-app-title">Manage repeat project commands</h2>
        <p className="text-[13px] text-muted-foreground">
          Add a project folder, then save multi-line commands you run often.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={onAddProject}>
          <Plus size={16} />
          Add project
        </Button>
        <Button variant="outline" onClick={onImportProject}>
          <FileInput size={16} />
          Import .prd
        </Button>
      </div>
    </div>
  );
}
