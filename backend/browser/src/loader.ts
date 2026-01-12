// packages/browser/src/loader.ts
// Content script loader - injects bridge into MAIN world
//
// MV3 content scripts run in an isolated world, separate from the page's
// JavaScript context. Playwright's page.evaluate() runs in the MAIN world.
// To make __bridgeHandler accessible to Playwright, we inject the bridge
// code into the page's context via a script tag.

/// <reference path="./chrome.d.ts" />

const injectScript = (src: string): void => {
  const script = document.createElement("script");
  script.src = src;
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
};

// Inject the main content script into the page's MAIN world
// This makes window.__bridgeHandler accessible to Playwright
injectScript(chrome.runtime.getURL("content.js"));
