import { lazy, Suspense } from "react";
import type { Project } from "../lib/api";
import type { SettingsPageProps } from "./SettingsPage";
import type { ProjectDetailProps } from "./project-detail";
import {
  ProjectsSidebar,
  ProjectWorkspaceHeader,
  WelcomeWorkspace,
} from "./workspace-shell";

const SettingsPage = lazy(async () => {
  const module = await import("./SettingsPage");
  return { default: module.SettingsPage };
});

const ProjectDetail = lazy(async () => {
  const module = await import("./project-detail");
  return { default: module.ProjectDetail };
});

function WorkspaceSuspenseFallback({
  title = "Loading workspace",
  description = "Preparing the desktop interface...",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="welcome">
      <div className="welcome-copy">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}

export function AppWorkspace({
  projects,
  selectedProject,
  selectedProjectId,
  settingsOpen,
  onAddProject,
  onImportProject,
  onOpenSettings,
  onSelectProject,
  settingsProps,
  onOpenExplorer,
  onOpenTerminal,
  onShareProject,
  onEditProject,
  onAddCommand,
  projectDetailProps,
}: {
  projects: Project[];
  selectedProject: Project | null;
  selectedProjectId: number | null;
  settingsOpen: boolean;
  onAddProject: () => void;
  onImportProject: () => void;
  onOpenSettings: () => void;
  onSelectProject: (projectId: number) => void;
  settingsProps: SettingsPageProps;
  onOpenExplorer: () => void;
  onOpenTerminal: () => void;
  onShareProject: () => void;
  onEditProject: () => void;
  onAddCommand: () => void;
  projectDetailProps?: ProjectDetailProps;
}) {
  return (
    <>
      <ProjectsSidebar
        projects={projects}
        selectedProjectId={selectedProjectId}
        settingsOpen={settingsOpen}
        onAddProject={onAddProject}
        onImportProject={onImportProject}
        onOpenSettings={onOpenSettings}
        onSelectProject={onSelectProject}
      />

      <section className="workspace flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
        {settingsOpen ? (
          <Suspense
            fallback={
              <WorkspaceSuspenseFallback
                title="Loading settings"
                description="Preparing appearance, terminal, and system preferences..."
              />
            }
          >
            <SettingsPage {...settingsProps} />
          </Suspense>
        ) : selectedProject && projectDetailProps ? (
          <>
            <ProjectWorkspaceHeader
              selectedProject={selectedProject}
              onOpenExplorer={onOpenExplorer}
              onOpenTerminal={onOpenTerminal}
              onShareProject={onShareProject}
              onEditProject={onEditProject}
              onAddCommand={onAddCommand}
            />

            <Suspense
              fallback={
                <WorkspaceSuspenseFallback
                  title="Loading project workspace"
                  description="Preparing commands, notes, and runtime panels..."
                />
              }
            >
              <ProjectDetail {...projectDetailProps} />
            </Suspense>
          </>
        ) : (
          <WelcomeWorkspace onAddProject={onAddProject} onImportProject={onImportProject} />
        )}
      </section>
    </>
  );
}

