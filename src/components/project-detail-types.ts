import type { ProjectCommand } from "../lib/api";
export type { ProjectNote } from "../lib/project-notes";

export type CommandSection = {
  section: string;
  commands: ProjectCommand[];
};
