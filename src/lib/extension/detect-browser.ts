import type { SupportedBrowser } from "@/src/lib/extension/browsers";

export interface BrowserSignals {
  /** `navigator.userAgentData.brands`, when the engine provides it. */
  readonly brands?: readonly { readonly brand: string }[];
  /** True when `navigator.brave` exists. Brave hides itself from the UA. */
  readonly isBrave?: boolean;
  /** `navigator.userAgentData.mobile`, when available. */
  readonly mobile?: boolean;
  readonly userAgent: string;
}

export interface DetectedBrowser {
  readonly browser: SupportedBrowser;
  /** The extension flow is desktop-only. */
  readonly mobile: boolean;
  /**
   * True only when the browser was positively identified and cannot run
   * either build (Safari today). Unrecognised browsers stay `unknown` with
   * `unsupported: false` so the manual picker still works.
   */
  readonly unsupported: boolean;
}

const MOBILE_PATTERN = /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk/i;

function hasBrand(
  brands: readonly { readonly brand: string }[] | undefined,
  name: string,
) {
  return (
    brands?.some((entry) => entry.brand.toLowerCase() === name.toLowerCase()) ??
    false
  );
}

/**
 * Deliberately conservative: an unrecognised Chromium fork resolves to
 * `unknown` rather than being guessed into a branded download.
 */
export function detectBrowser(signals: BrowserSignals): DetectedBrowser {
  const { brands, isBrave = false, userAgent } = signals;
  const mobile = signals.mobile ?? MOBILE_PATTERN.test(userAgent);
  const detected = (
    browser: SupportedBrowser,
    unsupported = false,
  ): DetectedBrowser => ({ browser, mobile, unsupported });

  if (/Firefox\/|FxiOS\//.test(userAgent) || hasBrand(brands, "Firefox")) {
    return detected("firefox");
  }

  if (isBrave || hasBrand(brands, "Brave")) {
    return detected("brave");
  }

  if (hasBrand(brands, "Opera GX") || /\bOPX\//.test(userAgent)) {
    return detected("opera-gx");
  }

  if (hasBrand(brands, "Opera") || /\bOPR\//.test(userAgent)) {
    return detected("opera");
  }

  if (
    hasBrand(brands, "Microsoft Edge") ||
    /\bEdg(?:A|iOS)?\//.test(userAgent)
  ) {
    return detected("edge");
  }

  if (hasBrand(brands, "Google Chrome") || /\bCriOS\//.test(userAgent)) {
    return detected("chrome");
  }

  // Safari is the only engine we can name as unsupported with confidence.
  if (
    /Safari\//.test(userAgent) &&
    !/Chrom(?:e|ium)\//.test(userAgent) &&
    brands === undefined
  ) {
    return detected("unknown", true);
  }

  // A bare `Chrome/` token without brand data is most often plain Chrome, but
  // it is also what several forks report. Only claim Chrome when nothing else
  // in the string suggests a fork.
  if (
    /\bChrome\//.test(userAgent) &&
    !/\b(?:OPR|Edg|Vivaldi|YaBrowser|Whale|SamsungBrowser|Brave)\b/.test(
      userAgent,
    )
  ) {
    return detected(brands === undefined ? "chrome" : "unknown");
  }

  return detected("unknown");
}

/** Reads the signals from the live browser. Client-side only. */
export function readBrowserSignals(): BrowserSignals {
  const data = (
    navigator as Navigator & {
      userAgentData?: {
        brands?: readonly { readonly brand: string }[];
        mobile?: boolean;
      };
    }
  ).userAgentData;

  return {
    brands: data?.brands,
    isBrave: "brave" in navigator,
    mobile: data?.mobile,
    userAgent: navigator.userAgent,
  };
}
