import { FileInput, FolderOpen, Pencil, Plus, Settings, Share2, Terminal } from "lucide-react";
import appIcon from "../assets/app-icon.png";
import type { Project } from "../lib/api";
import { EntityAvatar } from "./entity-avatar";
import { Button } from "./ui/button";

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
        <Button onClick={onAddProject}>
          <Plus size={15} />
          Add Project
        </Button>
        <Button variant="outline" onClick={onImportProject}>
          <FileInput size={15} />
          Import .prd
        </Button>
      </div>

      <div className="project-list">
        {projects.map((project) => (
          <Button
            type="button"
            variant="ghost"
            className={`project-row ${selectedProjectId === project.id ? "active" : ""}`}
            key={project.id}
            onClick={() => onSelectProject(project.id)}
          >
            <EntityAvatar name={project.name} path={project.avatar_path} />
            <span>
              <strong>{project.name}</strong>
            </span>
          </Button>
        ))}
        {projects.length === 0 && <p className="empty-text">Create your first project to start running commands.</p>}
      </div>
      <div className="sidebar-footer">
        <Button className="settings-button" variant={settingsOpen ? "secondary" : "ghost"} onClick={onOpenSettings}>
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
      <header className="workspace-header">
        <div className="title-cluster">
          <EntityAvatar name={selectedProject.name} path={selectedProject.avatar_path} />
          <div className="workspace-title-block">
            <h2>{selectedProject.name}</h2>
            <p className="workspace-path">{selectedProject.path}</p>
          </div>
        </div>
        <div className="toolbar project-toolbar">
          <div className="toolbar-group toolbar-group-utility">
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
          <div className="toolbar-group toolbar-group-primary">
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

      {selectedProject.description && <p className="project-description">{selectedProject.description}</p>}
    </>
  );
}

export interface WelcomeWorkspaceProps {
  onAddProject: () => void;
  onImportProject: () => void;
}

export function WelcomeWorkspace({ onAddProject, onImportProject }: WelcomeWorkspaceProps) {
  return (
    <div className="welcome">
      <img className="welcome-icon" src={appIcon} alt="" />
      <div className="welcome-copy">
        <h2>Manage repeat project commands</h2>
        <p>Add a project folder, then save multi-line commands you run often.</p>
      </div>
      <div className="welcome-actions">
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
