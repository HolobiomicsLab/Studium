import { App } from "@modelcontextprotocol/ext-apps/app-with-deps";
import "./artifact-pane.js";
import { connectMcpApp } from "./bridge-mcp-app.js";
connectMcpApp(new App({ name: "Studium lesson", version: "0.6.0" }, {}, { autoResize: false }))
  .catch(error => window.renderView({ type: "error", message: error.message }));
