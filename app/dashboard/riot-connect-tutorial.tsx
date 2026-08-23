"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

import { ExtensionDownload } from "@/app/dashboard/extension-download";
import type { BrowserTarget } from "@/app/dashboard/use-browser-target";
import {
  browserProfile,
  type SupportedBrowser,
} from "@/src/lib/extension/browsers";

interface RiotConnectTutorialProps {
  readonly select: (browser: SupportedBrowser) => void;
  readonly target: BrowserTarget;
}

export function RiotConnectTutorial({
  select,
  target,
}: RiotConnectTutorialProps) {
  const [isOpen, setIsOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
      if (event.key !== "Tab") return;

      // The dialog now carries its own controls, so Tab cycles within them
      // instead of pinning focus to Close.
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        "a[href], button:not(:disabled)",
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [isOpen]);

  const profile = browserProfile(target.browser);
  const showSteps = target.resolved && !target.mobile && !target.unsupported;

  return (
    <>
      <button
        className="riot-tutorial-trigger"
        onClick={() => setIsOpen(true)}
        ref={triggerRef}
        type="button"
      >
        How to connect
      </button>

      {isOpen ? createPortal(
        <div
          aria-describedby="riot-tutorial-duration"
          aria-labelledby="riot-tutorial-title"
          aria-modal="true"
          className="riot-tutorial-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false);
          }}
          role="dialog"
        >
          <div className="riot-tutorial-dialog" ref={dialogRef}>
            <header className="riot-tutorial-header">
              <div>
                <h2 id="riot-tutorial-title">
                  How to connect your Riot account
                </h2>
                <p id="riot-tutorial-duration">Takes about 1 minute</p>
              </div>
              <button
                className="riot-tutorial-close"
                onClick={() => setIsOpen(false)}
                ref={closeButtonRef}
                type="button"
              >
                Close
              </button>
            </header>
            <div className="riot-tutorial-scroll">
              <ExtensionDownload
                select={select}
                target={target}
              />
              {showSteps && profile ? (
                <ol className="riot-tutorial-steps">
                  {profile.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              ) : null}
              {profile?.build === "chromium" ? (
                <Image
                  alt="Eight-step guide to download, unzip, and load the VAL Checker extension before signing in with Riot."
                  className="riot-tutorial-image"
                  height={1024}
                  loading="eager"
                  sizes="(max-width: 767px) 832px, 900px"
                  src="/images/val-checker-riot-account-setup-guide.png"
                  width={1536}
                />
              ) : null}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
