/**
 * Typed declaration for the privileged bridge the Electron desktop shell injects
 * as `window.valChecker`. This file must import nothing: it only augments the
 * global `Window` so the web app can detect the shell without coupling to it.
 *
 * In a plain browser (and in jsdom under test) `window.valChecker` is undefined.
 */

export type RiotDesktopCaptureResult =
  | { readonly ok: true; readonly jar: string }
  | {
      readonly ok: false;
      readonly reason: "cancelled" | "timeout" | "no-cookies";
    };

export interface ValCheckerDesktopBridge {
  readonly isDesktop: true;
  connectRiot(): Promise<RiotDesktopCaptureResult>;
}

declare global {
  interface Window {
    readonly valChecker?: ValCheckerDesktopBridge;
  }
}
