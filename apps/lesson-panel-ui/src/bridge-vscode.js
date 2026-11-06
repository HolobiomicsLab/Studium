// VS Code owns confirmations, file access and native reproduction tasks.
(function () {
  const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
  window.__send = (action) => vscode?.postMessage(action);
  window.addEventListener("message", (event) => {
    if (event.data?.type === "view") window.renderView(event.data.view);
  });
})();
