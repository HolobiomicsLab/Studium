/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LibraryScreen from "./LibraryScreen";

const { listBundles } = vi.hoisted(() => ({ listBundles: vi.fn() }));
vi.mock("../lib/tauri", () => ({ tauri: { listBundles } }));
const lessons = [
  { path: "/tmp/atoms.zip", bundle_id: "atoms", title: "Électrons et atomes", n_scenes: 10 },
  { path: "/tmp/metabo.zip", bundle_id: "metabo", title: "Métabolomique", n_scenes: 7 },
];
afterEach(cleanup);
beforeEach(() => {
  listBundles.mockReset().mockResolvedValue(lessons);
  delete (window as unknown as { __test_bundle_path?: string }).__test_bundle_path;
});
function openLibrary() {
  render(<MemoryRouter><LibraryScreen /></MemoryRouter>);
}

it("finds a lesson by title without requiring accents or case", async () => {
  openLibrary();
  await screen.findByText("Électrons et atomes");
  fireEvent.change(screen.getByRole("searchbox", { name: "Rechercher une leçon" }), {
    target: { value: "ELECTRONS" },
  });
  expect(screen.getAllByTestId("library-load-bundle")).toHaveLength(1);
  expect(screen.queryByText("Métabolomique")).toBeNull();
});

it("can clear an unsuccessful search without losing the installed lessons", async () => {
  openLibrary();
  await screen.findByText("Métabolomique");
  fireEvent.change(screen.getByRole("searchbox", { name: "Rechercher une leçon" }), {
    target: { value: "not-a-lesson" },
  });
  expect(screen.getByText(/aucune leçon ne correspond/i)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Effacer la recherche" }));
  expect(screen.getAllByTestId("library-load-bundle")).toHaveLength(2);
});

it("reports a native string rejection and offers a working retry", async () => {
  listBundles.mockRejectedValueOnce("Dossier inaccessible");
  openLibrary();
  expect((await screen.findByRole("alert")).textContent).toContain("Dossier inaccessible");
  fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
  await screen.findByText("Métabolomique");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(listBundles).toHaveBeenCalledTimes(2);
});

it("keeps a staged lesson usable while reporting a failed directory listing", async () => {
  (window as unknown as { __test_bundle_path?: string }).__test_bundle_path = "/tmp/staged.zip";
  listBundles.mockRejectedValueOnce(new Error("directory unavailable"));
  openLibrary();
  expect((await screen.findByRole("alert")).textContent).toContain("directory unavailable");
  expect(screen.getByTestId("library-load-bundle").getAttribute("data-bundle-path")).toBe("/tmp/staged.zip");
});
