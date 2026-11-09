// VS Code owns confirmations, file access and native reproduction tasks.
(function () {
  const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
  // The display delay the renderer measured travels beside the action; the extension takes it out again.
  window.__send = (action, meta) => vscode?.postMessage(meta ? { ...action, ...meta } : action);
  window.addEventListener("message", (event) => {
    if (event.data?.type === "view") window.renderView(event.data.view);
  });
})();
