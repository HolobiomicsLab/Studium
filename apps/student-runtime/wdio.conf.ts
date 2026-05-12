import { spawn, ChildProcess } from "child_process";
let tauriDriver: ChildProcess | null = null;

export const config = {
  hostname: "127.0.0.1",
  port: 4444,
  specs: ["./tests-e2e/**/*.test.ts"],
  maxInstances: 1,
  capabilities: [
    {
      "tauri:options": {
        application: "src-tauri/target/release/student-runtime",
      },
    } as WebdriverIO.Capabilities,
  ],
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 60000 },
  reporters: ["spec"],
  beforeSession: () => {
    tauriDriver = spawn("tauri-driver", [], {
      stdio: [null, process.stdout, process.stderr],
    });
  },
  afterSession: () => {
    tauriDriver?.kill();
  },
};
