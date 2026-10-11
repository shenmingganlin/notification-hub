import { hana } from "./sdk.js";
import { appearanceFromSnapshot, issuedStylesheetUrl } from "./widget-appearance.js";

function applyIssuedStylesheet(cssUrl) {
  const href = issuedStylesheetUrl(cssUrl, location.href);
  if (!href) return;
  let link = document.getElementById("hana-theme-css");
  if (!link) {
    link = document.createElement("link");
    link.id = "hana-theme-css";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  if (link.getAttribute("href") !== href) link.setAttribute("href", href);
}

function pushTheme(snapshot) {
  applyIssuedStylesheet(snapshot && snapshot.cssUrl);
  const bridge = window.__nhHostBridge;
  if (!bridge) return;
  bridge.setTheme({
    appearance: appearanceFromSnapshot(snapshot),
    cssUrl: snapshot && snapshot.cssUrl || "",
  });
}

function pushLifecycle(snapshot) {
  const bridge = window.__nhHostBridge;
  if (!bridge) return;
  const hidden = !snapshot || snapshot.visible === false || snapshot.active === false || snapshot.motion === "paused";
  bridge.setHidden(hidden);
}

try {
  hana.theme.subscribe(pushTheme);
  hana.lifecycle.subscribe(pushLifecycle);
  hana.ready();
} catch (err) {
  console.warn("[notification-hub] host theme follow skipped", err);
}
