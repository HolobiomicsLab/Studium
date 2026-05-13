/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import JournalEntry from "./JournalEntry";

vi.mock("../lib/tauri", () => ({
  journalCreate: vi.fn(async () => 42),
  journalUpdate: vi.fn(async () => undefined),
  journalList: vi.fn(async () => []),
}));

afterEach(cleanup);

describe("JournalEntry", () => {
  it("renders textarea + save button", () => {
    render(<JournalEntry sceneId="s-disc-1" emit={vi.fn()} />);
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(screen.getByRole("button", { name: /sauvegarder/i })).toBeTruthy();
  });

  it("saves text and emits journal_entry_submitted on first save", async () => {
    const emit = vi.fn();
    const { journalCreate } = await import("../lib/tauri");
    vi.mocked(journalCreate).mockResolvedValueOnce(42);
    render(<JournalEntry sceneId="s-disc-1" emit={emit} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Mon journal" } });
    fireEvent.click(screen.getByRole("button", { name: /sauvegarder/i }));
    await waitFor(() => {
      expect(journalCreate).toHaveBeenCalledWith("s-disc-1", "Mon journal");
      expect(emit).toHaveBeenCalledWith({
        type: "journal_entry_submitted",
        scene_id: "s-disc-1",
        entry_length: 11,
        revision_count: 0,
        is_revision: false,
      });
    });
  });

  it("loads existing entry and updates with incremented revision", async () => {
    const emit = vi.fn();
    const { journalList, journalUpdate } = await import("../lib/tauri");
    vi.mocked(journalList).mockResolvedValueOnce([{
      id: 42, scene_id: "s-disc-1", content_encrypted: "draft v0",
      created_at: "2026-05-13T10:00:00Z", updated_at: "2026-05-13T10:00:00Z",
      revision_index: 0,
    }]);
    render(<JournalEntry sceneId="s-disc-1" emit={emit} />);
    await waitFor(() => {
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("draft v0");
    });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft v1" } });
    fireEvent.click(screen.getByRole("button", { name: /sauvegarder/i }));
    await waitFor(() => {
      expect(journalUpdate).toHaveBeenCalledWith(42, "draft v1");
      expect(emit).toHaveBeenCalledWith({
        type: "journal_entry_submitted",
        scene_id: "s-disc-1",
        entry_length: 8,
        revision_count: 1,
        is_revision: true,
      });
    });
  });
});
