/**
 * E2E WebdriverIO spec — A.10 step 2 (handoff a2-scene-synth.md).
 *
 * Loads a bundle produced by ``services/scene-synth`` and asserts the runtime
 * dispatches all 6 scene types via SceneRouter. Requires:
 *   - ``tauri-driver`` available on PATH
 *   - the runtime bundled (``pnpm tauri:build``)
 *   - a fresh bundle ZIP at the path stored in ``window.__test_bundle_path``
 *     (fixture-bake script: see ``tools/e2e-a10.sh``).
 *
 * Disk-pressure note (2026-05-09): on dev box the release bundle was not
 * built due to <2 GB free. Spec file is committed for reproducibility; run
 * after disk cleanup + ``pnpm tauri:build``.
 */
describe("scene-synth bundle plays through 6 scene types", () => {
  const expectedTypes = [
    "intro",
    "concept",
    "quiz",
    "meta_checkpoint",
    "reproduction",
    "ai_critique",
  ];

  it("dispatches each scene type through SceneRouter", async () => {
    // Arrange — bundle path injected into the page (see tools/e2e-a10.sh)
    await browser.execute(() => {
      (window as unknown as { __test_bundle_path: string }).__test_bundle_path =
        "/tmp/studium-e2e/demo-fresh.zip";
    });

    // Click "Charger le bundle de démo" (testid on Library view)
    const loadBtn = await $("[data-testid='library-load-bundle']");
    await loadBtn.click();

    const player = await $("[data-testid='lesson-player']");
    await player.waitForDisplayed({ timeout: 10_000 });

    // Walk through each scene; ``data-scene-type`` attribute is set by
    // SceneRouter on the wrapping <section>.
    for (const t of expectedTypes) {
      const renderer = await $(`[data-scene-type='${t}']`);
      await renderer.waitForDisplayed({ timeout: 5_000 });
      // Cheap interaction depending on type
      switch (t) {
        case "quiz": {
          await $(`[data-scene-type='quiz'] input[type='radio']`).click();
          await $(`button*=Soumettre`).click();
          break;
        }
        case "reproduction": {
          await $(`input[aria-label='étape 1']`).setValue("ok");
          await $(`button*=Valider`).click();
          break;
        }
        case "ai_critique": {
          await $(`textarea[aria-label='critique-textarea']`).setValue(
            "Critique de test E2E suffisamment longue.",
          );
          await $(`button*=Soumettre`).click();
          break;
        }
        default:
          break;
      }
      const next = await $(`button*=Continuer`);
      if (await next.isExisting()) await next.click();
    }
  });
});
