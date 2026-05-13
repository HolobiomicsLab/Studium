/**
 * E2E WebdriverIO spec — M5.11 (2 sessions cross-session + endpoints M5).
 *
 * Extension de `telemetry-end-to-end.spec.ts` (C.8) pour M5 :
 *   1. Joue UN parcours complet (session 1) → asserte ≥ 30 events émis.
 *   2. Capture le pseudonyme via `window.__pseudonyme` (best-effort) et
 *      l'émet via `console.log("[e2e-m5] pseudonyme=…")` pour
 *      tools/e2e-m5.sh qui s'en sert dans /metrics/ai-literacy.
 *   3. Re-rentre dans la Library, recharge le bundle de démo, joue UN
 *      second parcours complet (session 2) — l'état Beta doit persister
 *      via SQLCipher → asserte ≥ 60 events cumulés.
 *
 * Pré-requis runtime :
 *   - `tauri-driver` sur le PATH (Linux/Windows uniquement — macOS bloqué,
 *     vérifié 2026-05-12).
 *   - `pnpm tauri:build` exécuté (binaire release dans src-tauri/target/).
 *   - `services/analytics-collector` démarré sur http://localhost:8003.
 *   - Un bundle de démo accessible via Library
 *     (`/tmp/studium-e2e/demo-fresh.zip`, idem C.8).
 *
 * Exécution macOS : impossible. Ce spec tourne via le workflow CI Linux (D.5).
 */
describe("M5 end-to-end pipeline (M5.11) — 2-sessions cross-session", () => {
  const expectedSceneTypes = [
    "intro",
    "concept",
    "quiz",
    "meta_checkpoint",
    "reproduction",
    "ai_critique",
  ];

  /** Patch fetch pour compter les events POSTés vers /telemetry. */
  const installFetchCounter = async (): Promise<void> => {
    await browser.execute(() => {
      const w = window as unknown as {
        __telemetry_endpoint?: string;
        __course_token?: string;
        __emitted_count?: number;
        __emitted_events?: unknown[];
        __test_bundle_path?: string;
        __pseudonyme?: string;
        fetch: typeof fetch;
      };
      w.__telemetry_endpoint = "http://localhost:8003/telemetry";
      w.__course_token = "e2e-course";
      w.__emitted_count = 0;
      w.__emitted_events = [];
      w.__test_bundle_path = "/tmp/studium-e2e/demo-fresh.zip";

      const realFetch = w.fetch.bind(window);
      w.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        try {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url;
          if (
            init?.method === "POST" &&
            typeof url === "string" &&
            url.includes("/telemetry") &&
            typeof init?.body === "string"
          ) {
            const parsed = JSON.parse(init.body) as {
              events?: unknown[];
              pseudonyme?: string;
            };
            if (Array.isArray(parsed.events)) {
              w.__emitted_count = (w.__emitted_count ?? 0) + parsed.events.length;
              (w.__emitted_events as unknown[]).push(...parsed.events);
            }
            if (typeof parsed.pseudonyme === "string" && !w.__pseudonyme) {
              w.__pseudonyme = parsed.pseudonyme;
            }
          }
        } catch {
          /* swallow — best effort */
        }
        return realFetch(input as RequestInfo, init);
      }) as typeof fetch;
    });
  };

  /** Parcours complet : consent (1ʳᵉ session) → library → 6 scènes → fin. */
  const playFullParcours = async (skipConsent = false): Promise<void> => {
    await browser.pause(1500);

    if (!skipConsent) {
      const consentUrl = await browser.getUrl();
      if (consentUrl.includes("/consent")) {
        const aBox = await $("#a");
        if (await aBox.isExisting()) {
          await aBox.click();
        }
        const continueBtn = await $("button*=Continuer");
        if (await continueBtn.isExisting()) {
          await continueBtn.click();
        }
        await browser.pause(500);
      }
    }

    const loadBtn = await $("[data-testid='library-load-bundle']");
    await loadBtn.waitForDisplayed({ timeout: 10_000 });
    await loadBtn.click();

    const player = await $("[data-testid='lesson-player']");
    await player.waitForDisplayed({ timeout: 10_000 });

    for (const sceneType of expectedSceneTypes) {
      const renderer = await $(`[data-scene-type='${sceneType}']`);
      await renderer.waitForDisplayed({ timeout: 8_000 });

      switch (sceneType) {
        case "quiz": {
          const radio = await $(
            `[data-scene-type='quiz'] input[type='radio']`,
          );
          if (await radio.isExisting()) {
            await radio.click();
            const submit = await $("button*=Soumettre");
            if (await submit.isExisting()) {
              await submit.click();
            }
          }
          break;
        }
        case "reproduction": {
          const step1 = await $("input[aria-label='étape 1']");
          if (await step1.isExisting()) {
            await step1.setValue("ok");
            const validate = await $("button*=Valider");
            if (await validate.isExisting()) {
              await validate.click();
            }
          }
          break;
        }
        case "ai_critique": {
          const textarea = await $("textarea[aria-label='critique-textarea']");
          if (await textarea.isExisting()) {
            await textarea.setValue(
              "Critique de test E2E suffisamment longue pour valider le flux.",
            );
            const submit = await $("button*=Soumettre");
            if (await submit.isExisting()) {
              await submit.click();
            }
          }
          break;
        }
        default:
          break;
      }

      const next = await $("button*=Continuer");
      if (await next.isExisting()) {
        await next.click();
        await browser.pause(300);
      }
    }

    // Laisse flush() final s'exécuter + force un beforeunload best-effort
    await browser.pause(2000);
    await browser.execute(() => {
      window.dispatchEvent(new Event("beforeunload"));
    });
    await browser.pause(500);
  };

  it("plays 2 sessions and asserts ≥30 then ≥60 events cumulés", async () => {
    // ── Setup global : injection overlay + fetch counter ────────────────
    await installFetchCounter();

    // ── Session 1 : parcours complet avec consentement ──────────────────
    await playFullParcours(false);

    const session1Count = await browser.execute(() => {
      const w = window as unknown as { __emitted_count?: number };
      return w.__emitted_count ?? 0;
    });
    // eslint-disable-next-line no-console
    console.log(`[e2e-m5] session1_count=${session1Count}`);
    expect(session1Count).toBeGreaterThanOrEqual(30);

    // ── Capture du pseudonyme (best-effort) pour l'orchestrateur ───────
    const pseudonyme = await browser.execute(() => {
      const w = window as unknown as { __pseudonyme?: string };
      return w.__pseudonyme ?? "";
    });
    if (pseudonyme) {
      // Le script tools/e2e-m5.sh grep ce log pour remplir /tmp/test-pseudo
      // et alimenter l'assertion /metrics/ai-literacy.
      // eslint-disable-next-line no-console
      console.log(`[e2e-m5] pseudonyme=${pseudonyme}`);
    }

    // ── Session 2 : re-entry Library + re-play même bundle ─────────────
    // L'état Beta (consent, profil pseudonyme) doit persister via SQLCipher.
    await browser.url("/library");
    await browser.pause(1000);
    await playFullParcours(true);

    const totalCount = await browser.execute(() => {
      const w = window as unknown as { __emitted_count?: number };
      return w.__emitted_count ?? 0;
    });
    // eslint-disable-next-line no-console
    console.log(`[e2e-m5] session2_total=${totalCount}`);
    expect(totalCount).toBeGreaterThanOrEqual(60);
  });
});
