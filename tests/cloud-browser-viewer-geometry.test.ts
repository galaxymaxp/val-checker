import { describe, expect, it } from "vitest";

import {
  normalizeContainedPoint,
  shouldForwardViewerKey,
  viewerPrintableText,
} from "@/cloud-browser/src/viewer-geometry";

describe("cloud browser viewer geometry", () => {
  it("maps a same-aspect-ratio frame directly", () => {
    expect(
      normalizeContainedPoint({
        containerHeight: 500,
        containerWidth: 1000,
        contentHeight: 500,
        contentWidth: 1000,
        localX: 250,
        localY: 400,
      }),
    ).toEqual({ x: 0.25, y: 0.8 });
  });

  it("removes horizontal letterboxing before mapping a click", () => {
    expect(
      normalizeContainedPoint({
        containerHeight: 600,
        containerWidth: 800,
        contentHeight: 800,
        contentWidth: 400,
        localX: 325,
        localY: 300,
      }),
    ).toEqual({ x: 0.25, y: 0.5 });
  });

  it("removes vertical letterboxing before mapping a click", () => {
    expect(
      normalizeContainedPoint({
        containerHeight: 800,
        containerWidth: 600,
        contentHeight: 400,
        contentWidth: 800,
        localX: 300,
        localY: 325,
      }),
    ).toEqual({ x: 0.5, y: 0.25 });
  });

  it("clamps clicks outside the rendered frame", () => {
    expect(
      normalizeContainedPoint({
        containerHeight: 600,
        containerWidth: 800,
        contentHeight: 800,
        contentWidth: 400,
        localX: 0,
        localY: 700,
      }),
    ).toEqual({ x: 0, y: 1 });
  });
});

describe("cloud browser viewer keyboard", () => {
  it.each(["Backspace", "Delete", "Enter", "Tab", "ArrowLeft"])(
    "forwards the %s editing key",
    (key) => {
      expect(
        shouldForwardViewerKey({
          altKey: false,
          ctrlKey: false,
          key,
          metaKey: false,
        }),
      ).toBe(true);
    },
  );

  it("leaves plain printable text to the input event", () => {
    expect(
      shouldForwardViewerKey({
        altKey: false,
        ctrlKey: false,
        key: "a",
        metaKey: false,
      }),
    ).toBe(false);
  });

  it("forwards printable keys when they are part of a shortcut", () => {
    expect(
      shouldForwardViewerKey({
        altKey: false,
        ctrlKey: true,
        key: "a",
        metaKey: false,
      }),
    ).toBe(true);
  });

  it.each([
    ["a", "a"],
    ["A", "A"],
    ["!", "!"],
  ])("uses %s as canvas fallback text", (key, expected) => {
    expect(
      viewerPrintableText({
        altKey: false,
        ctrlKey: false,
        key,
        metaKey: false,
      }),
    ).toBe(expected);
  });

  it("does not turn editing keys or shortcuts into text", () => {
    expect(
      viewerPrintableText({
        altKey: false,
        ctrlKey: false,
        key: "Backspace",
        metaKey: false,
      }),
    ).toBeNull();
    expect(
      viewerPrintableText({
        altKey: false,
        ctrlKey: true,
        key: "a",
        metaKey: false,
      }),
    ).toBeNull();
  });
});
