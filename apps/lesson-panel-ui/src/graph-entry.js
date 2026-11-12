import { App } from "@modelcontextprotocol/ext-apps/app-with-deps";
import "./graph-pane.js";
import { connectMcpApp } from "./bridge-mcp-app.js";
connectMcpApp(new App({ name: "Studium graph", version: "0.6.2" }, {}, { autoResize: false }))
  .catch(error => { document.getElementById("graph").textContent = error.message; });
