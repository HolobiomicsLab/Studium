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
 *
 * Selectors alignés sur `m5-end-to-end.spec.ts` (id HTML `#a` pour consent,
 * `button*=Continuer` pour navigation, `[data-testid='library-load-bundle']`
 * pour le chargement bundle, `[data-scene-type='…']` pour le routing scène).
 */
describe("Démo M6 atomistique — 2 sessions cross-session", () => {
  const expectedSceneTypes = [
    "intro",
    "concept",
    "quiz",
    "meta_checkpoint",
    "reproduction",
    "ai_critique",
  ];

  /**
   * Pose les hooks `window.__x` du harnais et compte les events postés au collector.
   *
   * `seed` : `browser.url(...)` est une navigation document. Elle détruit `window`, donc TOUT
   * ce que cette fonction installe — le chemin du bundle, l'endpoint, le token du cours, le
   * patch de `fetch` et le compteur. La session 2 repart de la bibliothèque par une navigation ;
   * sans report explicite, « ≥ 50 cumulés » serait lu sur un compteur que le rechargement vient
   * de remettre à zéro et ne mesurerait que la session 2. (INT-STUDIUM-033)
   */
  const installFetchCounter = async (seed = 0): Promise<void> => {
    await browser.execute((initial: number) => {
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
      w.__emitted_count = initial;
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
        return realFetch(input as RequestInfo, init);
      }) as typeof fetch;
    }, seed);
  };

  const getEmittedCount = async (): Promise<number> =>
    (await browser.execute(() => {
      const w = window as unknown as { __emitted_count?: number };
      return w.__emitted_count ?? 0;
    })) as number;

  /**
   * Les hooks posés par `installFetchCounter` sont-ils encore là ?
   *
   * `getEmittedCount` renvoie 0 aussi bien pour « aucun event » que pour « le compteur n'existe
   * plus », et c'est cette confusion qui a fait passer une assertion cumulée pour une mesure.
   * Le harnais doit donc constater l'absence, pas la lire comme un zéro.
   */
  const counterIsArmed = async (): Promise<boolean> =>
    (await browser.execute(() => {
      const w = window as unknown as {
        __emitted_count?: number;
        __test_bundle_path?: string;
      };
      return typeof w.__emitted_count === "number" && typeof w.__test_bundle_path === "string";
    })) as boolean;

  /**
   * Parcours complet :
   *   consent (1ʳᵉ session uniquement) → library load bundle → boucle scènes → fin.
   *
   * Selectors identiques à `m5-end-to-end.spec.ts` :
   *   - Consent A   : `#a` (checkbox HTML id)
   *   - Continuer   : `button*=Continuer`
   *   - Library     : `[data-testid='library-load-bundle']`
   *   - Player      : `[data-testid='lesson-player']`
   *   - Scène       : `[data-scene-type='<type>']`
   */
  const playFullParcours = async (skipConsent = false): Promise<void> => {
    await browser.pause(1500);

    // Une navigation ajoutée n'importe où dans ce parcours effacerait les hooks sans rien
    // casser de visible : la bibliothèque se viderait et le compteur repartirait de zéro, et
    // l'assertion finale mesurerait alors autre chose que ce que son libellé annonce.
    if (!(await counterIsArmed())) {
      throw new Error(
        "hooks du harnais absents : une navigation document a réinitialisé `window`. " +
          "Rappeler installFetchCounter(compteurReporté) après chaque browser.url().",
      );
    }

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
              "Critique de test E2E pour démo M6 atomistique — contenu minimal valide.",
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

  it("session 1 — Leçon 1 (6 scènes) → ≥ 30 events", async () => {
    await installFetchCounter();
    await playFullParcours(false);

    const count = await getEmittedCount();
    // eslint-disable-next-line no-console
    console.log(`[demo-m6] session 1 events: ${count}`);
    expect(count).toBeGreaterThanOrEqual(30);
  });

  it("session 2 — Leçon 2 cross-session → ≥ 50 cumulés", async () => {
    // Pas de reset : la session 1 a posé l'état SQLCipher.
    // On retourne à la Library pour relancer un parcours — l'état Beta
    // (consent, profil pseudonyme) doit persister.
    //
    // Le compteur est lu AVANT la navigation, qui va détruire `window` avec tout ce que le
    // harnais y avait posé, puis reposé comme graine juste après. C'est ce report qui fait de
    // l'assertion ci-dessous un cumul des deux sessions ; sans lui elle ne mesurait que la
    // seconde. (INT-STUDIUM-033)
    const carried = await getEmittedCount();
    expect(carried).toBeGreaterThan(0);

    await browser.url("/library");
    await installFetchCounter(carried);
    await browser.pause(1000);

    await playFullParcours(true);

    const count = await getEmittedCount();
    // eslint-disable-next-line no-console
    console.log(`[demo-m6] session 2 cumulé: ${count}`);
    expect(count).toBeGreaterThanOrEqual(50);
  });
});
