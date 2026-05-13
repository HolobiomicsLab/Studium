/**
 * E2E WebdriverIO spec — Démo M6 atomistique L1 SV.
 *
 * Joue 2 sessions consécutives cross-session :
 *  - Session 1 : Leçon 1 (6 scènes) → asserte ≥ 30 events
 *  - Session 2 : Leçon 2 (4 scènes) cross-session adaptation visible
 *                → asserte ≥ 50 events cumulés
 *
 * Pré-requis :
 *  - `tauri-driver` sur PATH (Linux/Windows ; macOS bloqué).
 *  - `pnpm tauri:build --debug` exécuté.
 *  - `services/analytics-collector` démarré sur http://localhost:8003.
 *  - Bundle accessible `/tmp/studium-e2e/demo-atomistique.zip`.
 *
 * Exécution macOS : impossible. CI Linux only (workflow D.5).
 */
describe("Démo M6 atomistique — 2 sessions cross-session", () => {
  const installFetchCounter = async (): Promise<void> => {
    await browser.execute(() => {
      const w = window as unknown as {
        __telemetry_endpoint?: string;
        __course_token?: string;
        __emitted_count?: number;
        __test_bundle_path?: string;
        __pseudonyme?: string;
        fetch: typeof fetch;
      };
      w.__telemetry_endpoint = "http://localhost:8003/telemetry";
      w.__course_token = "demo-m6";
      w.__emitted_count = 0;
      w.__test_bundle_path = "/tmp/studium-e2e/demo-atomistique.zip";

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
            const parsed = JSON.parse(init.body) as { events?: unknown[] };
            if (Array.isArray(parsed.events)) {
              w.__emitted_count = (w.__emitted_count ?? 0) + parsed.events.length;
            }
          }
        } catch {
          /* swallow */
        }
        return realFetch(input, init);
      }) as typeof fetch;
    });
  };

  const getEmittedCount = async (): Promise<number> =>
    (await browser.execute(() => {
      const w = window as unknown as { __emitted_count?: number };
      return w.__emitted_count ?? 0;
    })) as number;

  const consentAndOpenLibrary = async (): Promise<void> => {
    // Consent A obligatoire
    const consentA = await $('[data-testid="consent-A-accept"]');
    await consentA.waitForClickable({ timeout: 10000 });
    await consentA.click();
    const submit = await $('[data-testid="consent-submit"]');
    await submit.click();
    // Library s'ouvre
    const library = await $('[data-testid="library-screen"]');
    await library.waitForExist({ timeout: 5000 });
  };

  const playLessonFully = async (lessonScenes: number): Promise<void> => {
    // Click sur le bundle dans Library
    const bundleCard = await $('[data-testid="bundle-card"]');
    await bundleCard.waitForClickable({ timeout: 5000 });
    await bundleCard.click();

    // Boucle de jeu : appuie sur "Suivant" jusqu'à fin leçon
    for (let i = 0; i < lessonScenes; i++) {
      const next = await $('[data-testid="scene-next"]');
      await next.waitForClickable({ timeout: 15000 });
      // Si scène quiz : sélectionne 1ère réponse arbitrairement (correct ou non)
      const quizChoice = await $('[data-testid="quiz-choice-a"]');
      if (await quizChoice.isExisting()) {
        await quizChoice.click();
      }
      // Si discussion / reproduction : remplit champ avec réponse minimale
      const respField = await $('[data-testid="scene-response-input"]');
      if (await respField.isExisting()) {
        await respField.setValue(
          "Réponse de test E2E pour démo M6 atomistique — contenu minimal valide pour passer la scène.",
        );
      }
      await next.click();
      await browser.pause(500);
    }
  };

  it("session 1 — Leçon 1 (6 scènes) → ≥ 30 events", async () => {
    await installFetchCounter();
    await consentAndOpenLibrary();
    await playLessonFully(6);

    const count = await getEmittedCount();
    // eslint-disable-next-line no-console
    console.log(`[demo-m6] session 1 events: ${count}`);
    expect(count).toBeGreaterThanOrEqual(30);
  });

  it("session 2 — Leçon 2 (4 scènes) cross-session → ≥ 50 cumulés", async () => {
    // Pas de reset : la session 1 a posé l'état SQLCipher.
    // On relance la même fenêtre Tauri (état Beta préservé).
    await browser.refresh();
    await browser.pause(1000);

    await installFetchCounter();
    await consentAndOpenLibrary();
    await playLessonFully(4);

    const count = await getEmittedCount();
    // eslint-disable-next-line no-console
    console.log(`[demo-m6] session 2 cumulé: ${count}`);
    expect(count).toBeGreaterThanOrEqual(50);
  });
});
