import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { api, type Project, type ProjectCommand } from "../lib/api";
import { commandPorts, DEFAULT_SECTION } from "../lib/command-utils";

export function useCommandSections({
  selectedProject,
  commands,
  queryClient,
  onError,
}: {
  selectedProject: Project | null;
  commands: ProjectCommand[];
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

  const commandSections = useMemo(() => {
    const sections = new Map<string, ProjectCommand[]>();
    for (const command of commands) {
      const section = command.section?.trim() || DEFAULT_SECTION;
      sections.set(section, [...(sections.get(section) ?? []), command]);
    }

    if (selectedProject) {
      const projectEmptySections =
        emptySections[selectedProject.id] !== undefined ? emptySections[selectedProject.id] : [DEFAULT_SECTION];
      for (const section of projectEmptySections) {
        if (!sections.has(section)) {
          sections.set(section, []);
        }
      }
    }

    return Array.from(sections.entries()).map(([section, items]) => ({ section, commands: items }));
  }, [commands, selectedProject, emptySections]);

  function handleAddSectionSubmit(event: FormEvent) {
    event.preventDefault();
    const name = newSectionName.trim();
    if (!name || !selectedProject) return;

    const exists = commandSections.some((s) => s.section.toLowerCase() === name.toLowerCase());
    if (exists) {
      onError(new Error(`Section "${name}" already exists.`));
      return;
    }

    setEmptySections((current) => {
      const projectSections = current[selectedProject.id] !== undefined ? current[selectedProject.id] : [DEFAULT_SECTION];

      if (projectSections.includes(name)) return current;
      return {
        ...current,
        [selectedProject.id]: [...projectSections, name],
      };
    });

    setIsAddingSection(false);
    setNewSectionName("");
  }

  async function handleRenameSection(oldName: string, newName: string) {
    const cleanNewName = newName.trim();
    if (!cleanNewName || cleanNewName === oldName) {
      setRenamingSection(null);
      return;
    }

    if (!selectedProject) return;

    const exists = commandSections.some(
      (s) => s.section.toLowerCase() === cleanNewName.toLowerCase() && s.section !== oldName,
    );
    if (exists) {
      onError(new Error(`Section "${cleanNewName}" already exists.`));
      return;
    }

    try {
      const oldSectionCommands = commandSections.find((s) => s.section === oldName)?.commands ?? [];
      for (const cmd of oldSectionCommands) {
        await api.updateCommand(cmd.id, {
          project_id: cmd.project_id,
          name: cmd.name,
          script: cmd.script,
          avatar_path: cmd.avatar_path,
          ports: commandPorts(cmd),
          section: cleanNewName,
          order_index: cmd.order_index,
          run_in_external_terminal: cmd.run_in_external_terminal,
        });
      }

      setEmptySections((current) => {
        const projectSections = current[selectedProject.id];
        if (!projectSections) return current;
        return {
          ...current,
          [selectedProject.id]: projectSections.map((s) => (s === oldName ? cleanNewName : s)),
        };
      });

      void queryClient.invalidateQueries({ queryKey: ["commands", selectedProject.id] });
    } catch (error) {
      onError(error);
    } finally {
      setRenamingSection(null);
    }
  }

  function handleDeleteSection(section: string) {
    if (!selectedProject) {
      return;
    }

    setEmptySections((current) => {
      const projectSections = current[selectedProject.id] !== undefined ? current[selectedProject.id] : [DEFAULT_SECTION];
      return {
        ...current,
        [selectedProject.id]: projectSections.filter((item) => item !== section),
      };
    });
  }

  return {
    commandSections,
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
