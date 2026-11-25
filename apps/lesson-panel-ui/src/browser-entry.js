import "./artifact-pane.js";
import { connectMcpApp } from "./bridge-mcp-app.js";
import { startBrowserPlayer } from "./bridge-browser.js";
startBrowserPlayer({ window, document, connectMcpApp, renderView: window.renderView })
  .catch(error => window.renderView({ type: "error", message: error.message }));
