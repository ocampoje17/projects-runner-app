import type { ProjectCommand } from "../lib/api";
export type { ProjectNote } from "../lib/project-notes";

export type CommandSection = {
  id: number;
  project_id: number;
  order_index: number;
  section: string;
  commands: ProjectCommand[];
};
