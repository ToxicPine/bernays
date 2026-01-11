// packages/browser/src/background.ts
// Background service worker for browser extension
/// <reference path="./chrome.d.ts" />

chrome.runtime.onInstalled.addListener(() => {
  console.log("Dubious Manhood Initialized...");
});
