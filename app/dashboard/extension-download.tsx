"use client";

import type { Ref } from "react";

import type { BrowserTarget } from "@/app/dashboard/use-browser-target";
import {
  BROWSER_ORDER,
  BROWSER_PROFILES,
  FIREFOX_DISTRIBUTION_NOTE,
  SUPPORTED_BROWSER_NAMES,
  browserProfile,
  extensionPackage,
  type SupportedBrowser,
} from "@/src/lib/extension/browsers";

interface ExtensionDownloadProps {
  readonly downloadRef?: Ref<HTMLAnchorElement>;
  readonly highlighted?: boolean;
  readonly onBlur?: () => void;
  readonly onFocus?: () => void;
  readonly select: (browser: SupportedBrowser) => void;
  readonly target: BrowserTarget;
}

function SupportedList() {
  return (
    <p className="riot-browser-supported">
      Supported: {SUPPORTED_BROWSER_NAMES.join(" · ")}
    </p>
  );
}

/**
 * Presents the extension download for the detected browser and always keeps a
 * manual way out: detection failing must never block the download.
 */
export function ExtensionDownload({
  downloadRef,
  highlighted = false,
  onBlur,
  onFocus,
  select,
  target,
}: ExtensionDownloadProps) {
  if (!target.resolved) {
    return null;
  }

  if (target.mobile) {
    return (
      <div className="riot-browser-picker" role="note">
        <p className="riot-browser-detected">
          Riot connection currently requires a desktop browser.
        </p>
        <p className="riot-extension-note">
          Supported desktop browsers: {SUPPORTED_BROWSER_NAMES.join(", ")}.
        </p>
      </div>
    );
  }

  if (target.unsupported) {
    return (
      <div className="riot-browser-picker" role="note">
        <p className="riot-browser-detected">
          This browser isn’t supported yet.
        </p>
        <SupportedList />
      </div>
    );
  }

  const profile = browserProfile(target.browser);

  if (!profile) {
    return (
      <div className="riot-browser-picker">
        <p className="riot-browser-detected">Choose your browser</p>
        <div className="riot-browser-choices">
          <button
            className="riot-browser-choice"
            onClick={() => select("chrome")}
            type="button"
          >
            Chrome / Chromium
          </button>
          <button
            className="riot-browser-choice"
            onClick={() => select("firefox")}
            type="button"
          >
            Firefox
          </button>
        </div>
        <SupportedList />
      </div>
    );
  }

  const archive = extensionPackage(target.browser);
  const others = BROWSER_ORDER.filter((id) => id !== profile.id);

  return (
    <div className="riot-browser-picker">
      <p className="riot-browser-detected">
        {target.selected
          ? `${profile.displayName} selected`
          : `${profile.displayName} detected`}
      </p>
      <a
        className={`riot-connect-download-link${
          highlighted ? " riot-connect-download-link-highlighted" : ""
        }`}
        download={archive?.filename}
        href={archive?.href}
        onBlur={onBlur}
        onFocus={onFocus}
        ref={downloadRef}
      >
        {profile.actionLabel}
      </a>
      {profile.build === "chromium" ? (
        <p className="riot-extension-note">
          Extract the ZIP before continuing. In {profile.displayName}, Load
          unpacked must select the extracted folder containing manifest.json—not
          the ZIP file.
        </p>
      ) : (
        <p className="riot-extension-note">{FIREFOX_DISTRIBUTION_NOTE}</p>
      )}
      <p className="riot-browser-switch">
        <span>Using another browser?</span>{" "}
        {others.map((id, index) => (
          <span key={id}>
            {index > 0 ? <span aria-hidden="true"> · </span> : null}
            <button
              className="riot-browser-switch-option"
              onClick={() => select(id)}
              type="button"
            >
              {BROWSER_PROFILES[id].displayName}
            </button>
          </span>
        ))}
      </p>
    </div>
  );
}
