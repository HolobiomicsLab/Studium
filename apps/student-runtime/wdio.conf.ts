import { spawn, ChildProcess } from "child_process";
import { connect } from "net";
import { stageBundle, type Executor } from "./tests-e2e/support/staged-bundle";
let tauriDriver: ChildProcess | null = null;

// Le binaire piloté par WDIO dépend de qui a construit l'application, et les
// harnais ne construisent pas tous le même profil : `e2e-m5.sh`, `e2e-c2.sh` et
// `e2e-a10.sh` lancent `tauri:build` (release), tandis que `e2e-demo-m6.sh` et le
// job CI `Tauri build` lancent `tauri:build --debug`. Le défaut reste donc
// `release` — c'est ce que construisent trois des quatre appelants — et le seul
// appelant qui construit en debug déclare son binaire via cette variable.
// Conséquence à énoncer : la démo M6 atteste le binaire debug, pas l'artefact
// livré à un étudiant. Pour qu'elle atteste le release, retirer `--debug` de
// `tools/e2e-demo-m6.sh` (coût : un second build Tauri complet dans le job).
// (INT-STUDIUM-033)
const RUNTIME_BIN =
  process.env.STUDIUM_RUNTIME_BIN ?? "src-tauri/target/release/student-runtime";

const DRIVER_PORT = 4444;

// tauri-driver met un instant à écouter sur 4444. `beforeSession` rendait la main
// dès le `spawn`, donc WDIO pouvait tenter la connexion avant que le port soit
// lié : la course était masquée jusqu'ici par un échec plus précoce (le pilote
// absent), et redeviendrait visible sous forme de rouge intermittent.
const waitForDriver = (timeoutMs = 15000): Promise<void> =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const socket = connect(DRIVER_PORT, "127.0.0.1");
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(
            new Error(
              `tauri-driver n'écoute pas sur 127.0.0.1:${DRIVER_PORT} après ${timeoutMs} ms`,
            ),
          );
        } else {
          setTimeout(attempt, 250);
        }
      });
    };
    attempt();
  });

export const config = {
  hostname: "127.0.0.1",
  port: DRIVER_PORT,
  // Les specs de `tests-e2e/specs/` sont volontairement HORS de ce glob : chacune
  // exige un environnement orchestré (services lancés, bundle déposé) et est
  // lancée par son propre script avec `--spec`. Un `pnpm wdio:run` nu exécute les
  // 9 specs autonomes de `tests-e2e/`, et rien d'autre.
  specs: ["./tests-e2e/**/*.test.ts"],
  maxInstances: 1,
  capabilities: [
    {
      "tauri:options": {
        application: RUNTIME_BIN,
      },
    } as WebdriverIO.Capabilities,
  ],
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 60000 },
  reporters: ["spec"],
  beforeSession: async () => {
    tauriDriver = spawn("tauri-driver", [], {
      stdio: [null, process.stdout, process.stderr],
    });
    // Sans ce handler, un `tauri-driver` absent du PATH émet un événement
    // `error` non traité, qui devient une exception non capturée au lieu d'un
    // message.
    tauriDriver.once("error", (err) => {
      console.error(`[wdio] tauri-driver n'a pas pu démarrer : ${err.message}`);
    });
    tauriDriver.once("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(
          `[wdio] tauri-driver s'est arrêté avec le code ${code} — ` +
            `WebKitWebDriver est-il installé (paquet webkit2gtk-driver) ?`,
        );
      }
    });
    await waitForDriver();
  },
  // Depuis INT-STUDIUM-034 la bibliothèque liste un répertoire de bundles : plus de leçon
  // intégrée, donc plus rien à cliquer pour une spec qui n'en met aucun en scène. Le chemin
  // est posé ici une fois, pour toutes les specs ; celles de `tests-e2e/specs/` s'exécutent
  // après ce hook et écrasent la valeur par la leur. Voir `tests-e2e/support/staged-bundle.ts`
  // pour la règle qui compte : une navigation document efface tout cela, et il faut rappeler
  // `stageBundle` derrière. (INT-STUDIUM-033)
  before: async (_capabilities: unknown, _specs: unknown, session: Executor) => {
    await stageBundle(session);
  },
  afterSession: () => {
    tauriDriver?.kill();
  },
};
