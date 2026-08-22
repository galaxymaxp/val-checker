"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

export function RiotConnectTutorial() {
  const [isOpen, setIsOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
      if (event.key === "Tab") {
        event.preventDefault();
        closeButtonRef.current?.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [isOpen]);

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
          <div className="riot-tutorial-dialog">
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
              <p className="riot-tutorial-intro">
                Chrome cannot load the downloaded ZIP directly. Extract it
                before choosing Load unpacked.
              </p>
              <ol className="riot-tutorial-steps">
                <li>Download the VAL Checker extension ZIP.</li>
                <li>
                  Unzip it with <strong>Extract All</strong>.
                </li>
                <li>
                  Open <code>chrome://extensions</code>.
                </li>
                <li>
                  Enable <strong>Developer mode</strong>.
                </li>
                <li>
                  Choose <strong>Load unpacked</strong>.
                </li>
                <li>
                  Select the extracted VAL Checker extension folder—the folder
                  containing <code>manifest.json</code>, not the ZIP.
                </li>
                <li>
                  Return to VAL Checker. It should show{" "}
                  <strong>Extension ready</strong>.
                </li>
                <li>
                  Choose <strong>Sign in with Riot</strong>.
                </li>
              </ol>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
