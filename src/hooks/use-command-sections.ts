import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { api, type Project, type ProjectCommand } from "../lib/api";
import { commandPorts, DEFAULT_SECTION } from "../lib/command-utils";
import type { CommandSection } from "../components/project-detail-types";

type CommandsByProjectId = Record<number, ProjectCommand[]>;

function buildCommandSections(commands: ProjectCommand[], persistedEmptySections: string[] | undefined) {
  const sections = new Map<string, ProjectCommand[]>();

  for (const command of commands) {
    const section = command.section?.trim() || DEFAULT_SECTION;
    sections.set(section, [...(sections.get(section) ?? []), command]);
  }

  for (const section of persistedEmptySections ?? [DEFAULT_SECTION]) {
    if (!sections.has(section)) {
      sections.set(section, []);
    }
  }

  return Array.from(sections.entries()).map<CommandSection>(([section, items]) => ({ section, commands: items }));
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
  const [emptySections, setEmptySections] = useState<Record<number, string[]>>(() => {
    try {
      const saved = localStorage.getItem("empty_sections");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [isAddingSection, setIsAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [renamingSection, setRenamingSection] = useState<string | null>(null);
  const [renameSectionValue, setRenameSectionValue] = useState("");
  const addSectionInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    localStorage.setItem("empty_sections", JSON.stringify(emptySections));
  }, [emptySections]);

  useEffect(() => {
    if (isAddingSection) {
      addSectionInputRef.current?.focus();
    }
  }, [isAddingSection]);

  const commandSectionsByProjectId = useMemo(
    () =>
      projects.reduce<Record<number, CommandSection[]>>((acc, project) => {
        acc[project.id] = buildCommandSections(commandsByProjectId[project.id] ?? [], emptySections[project.id]);
        return acc;
      }, {}),
    [commandsByProjectId, emptySections, projects],
  );

  const commandSections = selectedProjectId !== null ? commandSectionsByProjectId[selectedProjectId] ?? [] : [];

  function handleAddSectionSubmit(event: FormEvent, projectId = selectedProjectId) {
    event.preventDefault();
    if (projectId === null) {
      return;
    }

    const name = newSectionName.trim();
    if (!name) return;

    const projectSections = commandSectionsByProjectId[projectId] ?? [];
    const exists = projectSections.some((section) => section.section.toLowerCase() === name.toLowerCase());
    if (exists) {
      onError(new Error(`Section "${name}" already exists.`));
      return;
    }

    setEmptySections((current) => {
      const existingSections = current[projectId] !== undefined ? current[projectId] : [DEFAULT_SECTION];
      if (existingSections.includes(name)) {
        return current;
      }

      return {
        ...current,
        [projectId]: [...existingSections, name],
      };
    });

    setIsAddingSection(false);
    setNewSectionName("");
  }

  async function handleRenameSection(oldName: string, newName: string, projectId = selectedProjectId) {
    if (projectId === null) {
      return;
    }

    const cleanNewName = newName.trim();
    if (!cleanNewName || cleanNewName === oldName) {
      setRenamingSection(null);
      return;
    }

    const projectSections = commandSectionsByProjectId[projectId] ?? [];
    const exists = projectSections.some(
      (section) => section.section.toLowerCase() === cleanNewName.toLowerCase() && section.section !== oldName,
    );
    if (exists) {
      onError(new Error(`Section "${cleanNewName}" already exists.`));
      return;
    }

    try {
      const oldSectionCommands = projectSections.find((section) => section.section === oldName)?.commands ?? [];
      for (const command of oldSectionCommands) {
        await api.updateCommand(command.id, {
          project_id: command.project_id,
          name: command.name,
          script: command.script,
          avatar_path: command.avatar_path,
          ports: commandPorts(command),
          section: cleanNewName,
          order_index: command.order_index,
          runtime_mode: command.runtime_mode,
          run_in_external_terminal: command.run_in_external_terminal,
        });
      }

      setEmptySections((current) => {
        const existingSections = current[projectId];
        if (!existingSections) {
          return current;
        }

        return {
          ...current,
          [projectId]: existingSections.map((section) => (section === oldName ? cleanNewName : section)),
        };
      });

      void queryClient.invalidateQueries({ queryKey: ["commands", projectId] });
    } catch (error) {
      onError(error);
    } finally {
      setRenamingSection(null);
    }
  }

  function handleDeleteSection(sectionName: string, projectId = selectedProjectId) {
    if (projectId === null) {
      return;
    }

    setEmptySections((current) => {
      const existingSections = current[projectId] !== undefined ? current[projectId] : [DEFAULT_SECTION];
      return {
        ...current,
        [projectId]: existingSections.filter((section) => section !== sectionName),
      };
    });
  }

  return {
    commandSections,
    commandSectionsByProjectId,
    emptySections,
    isAddingSection,
    newSectionName,
    setNewSectionName,
    renamingSection,
    renameSectionValue,
    setRenameSectionValue,
    addSectionInputRef,
    handleAddSectionSubmit,
    handleRenameSection,
    handleDeleteSection,
    startAddSection: () => setIsAddingSection(true),
    cancelAddSection: () => {
      setIsAddingSection(false);
      setNewSectionName("");
    },
    startRenameSection: (section: string) => {
      setRenamingSection(section);
      setRenameSectionValue(section);
    },
    cancelRenameSection: () => setRenamingSection(null),
  };
}
