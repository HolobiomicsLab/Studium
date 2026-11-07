import { renderView } from "./artifact-pane.js";
/** Render previews and accept replacement views without a live service. */
export function connectStandalone(onAction = () => {}) {
  window.__send = onAction;
  if (window.__studiumView) renderView(window.__studiumView);
  window.addEventListener("studium:view", (event) => renderView(event.detail));
}
