// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { api, type Project } from "../lib/api";
import {
  projectNoteVersion,
  serializeProjectNotes,
  type ProjectNote,
} from "../lib/project-notes";
import { useProjectNotes } from "./use-project-notes";

vi.mock("../lib/api", () => ({
  isDesktopRuntime: () => true,
  api: { projectNotesMutate: vi.fn(), projectNotesList: vi.fn() },
}));
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("uses the editing baseline after external updates and preserves a failed draft", async () => {
  const original: ProjectNote = {
    id: "a",
    title: "A",
    content: "original",
    pinned: false,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
  const external = {
    ...original,
    content: "external",
    updatedAt: "2026-02-01",
  };
  const project = (notes: ProjectNote[]) =>
    ({
      id: 1,
      name: "Project",
      path: "E:/fixture",
      notes: serializeProjectNotes(notes),
    }) as Project;
  const onPersist = vi.fn();
  const hook = renderHook(
    ({ projects }) => useProjectNotes({ projects, onPersist }),
    { initialProps: { projects: [project([original])] } },
  );
  hook.rerender({ projects: [project([external])] });
  vi.mocked(api.projectNotesMutate).mockRejectedValue(
    new Error("Note changed. Reload before saving."),
  );
  await act(async () => {
    await expect(
      hook.result.current.handleSaveEditedProjectNote(
        1,
        "a",
        "A",
        "my draft",
        original,
      ),
    ).rejects.toThrow("Note changed");
  });
  expect(api.projectNotesMutate).toHaveBeenCalledWith(
    1,
    "update",
    expect.objectContaining({
      note_id: "a",
      content: "my draft",
      expected_version: await projectNoteVersion(original),
    }),
  );
  expect(onPersist).not.toHaveBeenCalled();
  expect(hook.result.current.projectNotesById[1][0].content).toBe("external");
});

it.each(["edited", "", " \n\t "])("persists edited content %j and reloads notes created concurrently", async (content) => {
  const a: ProjectNote = {
    id: "a",
    title: "A",
    content: "original",
    pinned: false,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
  const b = { ...a, id: "b", title: "B", content: "created by MCP" };
  const saved = [{ ...a, content: content.trim() }, b];
  vi.mocked(api.projectNotesMutate).mockResolvedValue(saved[0]);
  vi.mocked(api.projectNotesList).mockResolvedValue(saved);
  const onPersist = vi.fn().mockResolvedValue(undefined);
  const projects = [
    {
      id: 1,
      name: "Project",
      path: "E:/fixture",
      notes: serializeProjectNotes([a]),
    } as Project,
  ];
  const hook = renderHook(() => useProjectNotes({ projects, onPersist }));
  await act(async () => {
    await hook.result.current.handleSaveEditedProjectNote(
      1,
      "a",
      "A",
      content,
      a,
    );
  });
  expect(api.projectNotesMutate).toHaveBeenCalledTimes(1);
  expect(api.projectNotesMutate).toHaveBeenCalledWith(
    1,
    "update",
    expect.objectContaining({ note_id: "a", title: "A", content: content.trim() }),
  );
  expect(onPersist).toHaveBeenCalledWith(
    1,
    expect.objectContaining({ notes: serializeProjectNotes(saved) }),
    "Note updated",
  );
  expect(hook.result.current.projectNotesById[1]).toEqual(saved);
});
