"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

import type { SupportedBrowser } from "@/src/lib/extension/browsers";
import {
  detectBrowser,
  readBrowserSignals,
  type DetectedBrowser,
} from "@/src/lib/extension/detect-browser";

export interface BrowserTarget extends DetectedBrowser {
  /** True once detection has run on the client. */
  readonly resolved: boolean;
  /** True when the user picked this browser instead of detection. */
  readonly selected: boolean;
}

/**
 * The server cannot know the browser, so it renders nothing and the client
 * swaps in the detected browser after hydration. Going through
 * `useSyncExternalStore` keeps the server and hydration renders identical.
 */
const UNDETECTED: DetectedBrowser = {
  browser: "unknown",
  mobile: false,
  unsupported: false,
};

let cached: { readonly key: string; readonly value: DetectedBrowser } | null =
  null;

function subscribe() {
  // Detection is fixed for the life of the document.
  return () => {};
}

function clientSnapshot(): DetectedBrowser {
  const signals = readBrowserSignals();
  if (cached?.key !== signals.userAgent) {
    cached = { key: signals.userAgent, value: detectBrowser(signals) };
  }
  return cached.value;
}

function serverSnapshot(): DetectedBrowser {
  return UNDETECTED;
}

export function useBrowserTarget() {
  const detected = useSyncExternalStore(
    subscribe,
    clientSnapshot,
    serverSnapshot,
  );
  const [choice, setChoice] = useState<SupportedBrowser>();

  const select = useCallback((browser: SupportedBrowser) => {
    setChoice(browser);
  }, []);

  const target: BrowserTarget = choice
    ? {
        browser: choice,
        mobile: detected.mobile,
        resolved: true,
        selected: true,
        unsupported: false,
      }
    : { ...detected, resolved: detected !== UNDETECTED, selected: false };

  return { select, target };
}
