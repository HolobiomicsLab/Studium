/**
 * @vitest-environment jsdom
 */
// INT-STUDIUM-034 — the library loads a bundle.
//
// Four E2E harnesses (M6, M5, C.8/telemetry, A.10) share one contract with this screen:
// click `[data-testid='library-load-bundle']`, then `[data-testid='lesson-player']` appears
// playing the bundle at `window.__test_bundle_path`. None of it existed. `LibraryScreen` was
// a hardcoded card for `demo-metabolomics-001` with a `<Link>`, and `LessonPlayer` loaded a
// module constant, so the atomistique bundle the M6 demo builds and validates two steps
// earlier had no path through the user interface at all.
//
// The card also STATED a title, a level, a duration and a scene count as literal markup, for
// a bundle it never opened. Those claims could not be wrong, because nothing checked them —
// and could not be right either. Every field a row shows now comes from the file.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import LibraryScreen from "./LibraryScreen";

afterEach(cleanup);

const { listBundlesMock } = vi.hoisted(() => ({ listBundlesMock: vi.fn() }));

vi.mock("../lib/tauri", () => ({
  tauri: {
    listBundles: listBundlesMock,
  },
}));

const ATOMISTIQUE = {
  path: "/tmp/studium-e2e/demo-atomistique.zip",
  bundle_id: "atomistique-l1",
  title: "Atomistique L1",
  n_scenes: 10,
};
const METABO = {
  path: "/opt/bundles/metabo.zip",
  bundle_id: "demo-metabolomics-001",
  title: "Introduction à la métabolomique LC-MS",
  n_scenes: 7,
};

function renderLibrary() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<LibraryScreen />} />
        <Route path="/lesson/:lessonId" element={<div>PLAYER</div>} />
        <Route path="/settings" element={<div>SETTINGS</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listBundlesMock.mockReset().mockResolvedValue([ATOMISTIQUE, METABO]);
  delete (window as unknown as { __test_bundle_path?: string }).__test_bundle_path;
});

describe("LibraryScreen", () => {
  it("carries the load control the four E2E harnesses drive", async () => {
    renderLibrary();
    const buttons = await screen.findAllByTestId("library-load-bundle");
    expect(buttons.length).toBeGreaterThan(0);
    // it is a control, not a link: the harnesses click it and expect the player to open
    expect(buttons[0]!.tagName).toBe("BUTTON");
  });

  it("shows each bundle's own title and scene count, read from the file", async () => {
    renderLibrary();
    expect(await screen.findByText("Atomistique L1")).toBeTruthy();
    expect(screen.getByText(/10 scènes/)).toBeTruthy();
    expect(screen.getByText("Introduction à la métabolomique LC-MS")).toBeTruthy();
    expect(screen.getByText(/7 scènes/)).toBeTruthy();
  });

  it("opens the player on the bundle that was clicked, by path", async () => {
    const { container } = renderLibrary();
    const buttons = await screen.findAllByTestId("library-load-bundle");
    buttons[0]!.click();
    await waitFor(() => expect(container.textContent).toContain("PLAYER"));
  });

  it("honours window.__test_bundle_path, which is how the harnesses stage a bundle", async () => {
    (window as unknown as { __test_bundle_path?: string }).__test_bundle_path =
      "/tmp/studium-e2e/demo-fresh.zip";
    listBundlesMock.mockResolvedValue([METABO]);
    renderLibrary();

    await screen.findAllByTestId("library-load-bundle");
    // the staged path is offered whether or not it is in the bundles directory, and it is
    // offered FIRST: every harness clicks the first match
    const rows = screen.getAllByTestId("library-load-bundle");
    expect(rows[0]!.getAttribute("data-bundle-path")).toBe("/tmp/studium-e2e/demo-fresh.zip");
  });

  it("honours a bundle staged AFTER the screen is already open", async () => {
    // The four harnesses disagree on when they set the flag. M5, C.8 and M6 pass through
    // `/consent` first, so the library mounts after it exists; A.10 sets it with the app
    // already open, and M6's second session does too. A mount-time read would work for some
    // of them and, for the others, click through to a bundle nobody staged.
    listBundlesMock.mockResolvedValue([]);
    renderLibrary();
    await waitFor(() => expect(screen.queryByText(/aucune leçon/i)).toBeTruthy());

    (window as unknown as { __test_bundle_path?: string }).__test_bundle_path =
      "/tmp/studium-e2e/demo-atomistique.zip";

    const rows = await screen.findAllByTestId("library-load-bundle");
    expect(rows[0]!.getAttribute("data-bundle-path")).toBe(
      "/tmp/studium-e2e/demo-atomistique.zip",
    );
  });

  it("keeps the real title of a staged bundle that is also in the directory", async () => {
    // Hoisting the directory entry, rather than synthesising a row from the file name, is what
    // keeps the listed metadata true: the file already told us its title and scene count.
    (window as unknown as { __test_bundle_path?: string }).__test_bundle_path =
      ATOMISTIQUE.path;
    listBundlesMock.mockResolvedValue([METABO, ATOMISTIQUE]);
    renderLibrary();

    await waitFor(() =>
      expect(
        screen.getAllByTestId("library-load-bundle")[0]!.getAttribute("data-bundle-path"),
      ).toBe(ATOMISTIQUE.path),
    );
    expect(screen.getByText("Atomistique L1")).toBeTruthy();
    expect(screen.getByText(/10 scènes/)).toBeTruthy();
    // and it is offered once, not twice
    expect(screen.getAllByTestId("library-load-bundle")).toHaveLength(2);
  });

  it("an empty library says so instead of rendering nothing", async () => {
    listBundlesMock.mockResolvedValue([]);
    renderLibrary();
    await waitFor(() => expect(screen.queryByText(/aucune leçon/i)).toBeTruthy());
    expect(screen.queryAllByTestId("library-load-bundle")).toHaveLength(0);
  });

  it("a failing listing is reported, not swallowed into an empty library", async () => {
    // An empty list and a broken bridge look identical to a learner otherwise, and they need
    // different actions.
    listBundlesMock.mockRejectedValue(new Error("bridge down"));
    renderLibrary();
    await waitFor(() => expect(screen.queryByText(/bridge down/)).toBeTruthy());
  });
});
