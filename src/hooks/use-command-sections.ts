import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQueries } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { api, isDesktopRuntime, type Project, type ProjectCommand, type ProjectCommandSection } from "../lib/api";
import { DEFAULT_SECTION } from "../lib/command-utils";
import type { CommandSection } from "../components/project-detail-types";

type CommandsByProjectId = Record<number, ProjectCommand[]>;

function buildCommandSections(commands: ProjectCommand[], persistedSections: ProjectCommandSection[]) {
  const commandsBySection = new Map<string, ProjectCommand[]>();
  for (const command of commands) {
    const section = command.section?.trim() || DEFAULT_SECTION;
    commandsBySection.set(section.toLowerCase(), [...(commandsBySection.get(section.toLowerCase()) ?? []), command]);
  }

  return persistedSections.map<CommandSection>((section) => ({
    id: section.id,
    project_id: section.project_id,
    order_index: section.order_index,
    section: section.name,
    commands: commandsBySection.get(section.name.toLowerCase()) ?? [],
  }));
}

export function useCommandSections({
  projects,
  selectedProjectId,
  commandsByProjectId,
  queryClient,
  onError,
}: {
  projects: Project[];
  selectedProjectId: number | null;
  commandsByProjectId: CommandsByProjectId;
  queryClient: QueryClient;
  onError: (error: unknown) => void;
}) {
  const safeProjects = useMemo(() => (Array.isArray(projects) ? projects.filter((p): p is Project => Boolean(p) && typeof p.id === "number") : []), [projects]);
  const migrationStartedRef = useRef(false);
  const sectionQueries = useQueries({
    queries: safeProjects.map((project) => ({
      queryKey: ["command-sections", project.id],
      queryFn: () => api.listCommandSections(project.id),
      enabled: true,
    })),
  });

  const persistedSectionsByProjectId = useMemo(
    () =>
      safeProjects.reduce<Record<number, ProjectCommandSection[]>>((acc, project, index) => {
        acc[project.id] = sectionQueries[index]?.data ?? [];
        return acc;
      }, {}),
    [safeProjects, sectionQueries],
  );

  const commandSectionsByProjectId = useMemo(
    () =>
      safeProjects.reduce<Record<number, CommandSection[]>>((acc, project) => {
        acc[project.id] = buildCommandSections(
          commandsByProjectId[project.id] ?? [],
          persistedSectionsByProjectId[project.id] ?? [],
        );
        return acc;
      }, {}),
    [commandsByProjectId, persistedSectionsByProjectId, safeProjects],
  );

  useEffect(() => {
    if (!isDesktopRuntime() || migrationStartedRef.current || sectionQueries.some((query) => query.isPending)) {
      return;
    }
    const saved = localStorage.getItem("empty_sections");
    if (!saved) {
      migrationStartedRef.current = true;
      return;
    }

    let legacySections: Record<number, string[]>;
    try {
      legacySections = JSON.parse(saved) as Record<number, string[]>;
    } catch {
      localStorage.removeItem("empty_sections");
      migrationStartedRef.current = true;
      return;
    }

    migrationStartedRef.current = true;
    const activeProjectIds = new Set(projects.map((project) => project.id));
    void Promise.all(
      Object.entries(legacySections).flatMap(([projectId, names]) =>
        names.map(async (name) => {
          const numericProjectId = Number(projectId);
          if (!activeProjectIds.has(numericProjectId)) return;
          const exists = (persistedSectionsByProjectId[numericProjectId] ?? []).some(
            (section) => section.name.toLowerCase() === name.trim().toLowerCase(),
          );
          if (!exists && name.trim()) {
            await api.createCommandSection({ project_id: numericProjectId, name: name.trim() });
          }
        }),
      ),
    )
      .then(() => {
        localStorage.removeItem("empty_sections");
        void queryClient.invalidateQueries({ queryKey: ["command-sections"] });
      })
      .catch(onError);
  }, [onError, persistedSectionsByProjectId, projects, queryClient, sectionQueries]);

  const createMutation = useMutation({
    mutationFn: ({ projectId, name }: { projectId: number; name: string }) =>
      api.createCommandSection({ project_id: projectId, name }),
    onSuccess: (section) => {
      void queryClient.invalidateQueries({ queryKey: ["command-sections", section.project_id] });
    },
    onError,
  });

  const renameMutation = useMutation({
    mutationFn: ({ sectionId, name }: { sectionId: number; projectId: number; name: string }) =>
      api.renameCommandSection(sectionId, name),
    onSuccess: (section) => {
      void queryClient.invalidateQueries({ queryKey: ["command-sections", section.project_id] });
      void queryClient.invalidateQueries({ queryKey: ["commands", section.project_id] });
    },
    onError,
  });

  const deleteMutation = useMutation({
    mutationFn: ({ sectionId }: { sectionId: number; projectId: number }) => api.deleteCommandSection(sectionId),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["command-sections", variables.projectId] });
    },
    onError,
  });

  return {
    commandSections:
      selectedProjectId !== null ? commandSectionsByProjectId[selectedProjectId] ?? [] : [],
    commandSectionsByProjectId,
    createSection: async (projectId: number, name: string) => {
      await createMutation.mutateAsync({ projectId, name: name.trim() });
    },
    renameSection: async (projectId: number, sectionId: number, name: string) => {
      await renameMutation.mutateAsync({ projectId, sectionId, name: name.trim() });
    },
    deleteSection: async (projectId: number, sectionId: number) => {
      await deleteMutation.mutateAsync({ projectId, sectionId });
    },
    isMutatingSection: createMutation.isPending || renameMutation.isPending || deleteMutation.isPending,
  };
}
