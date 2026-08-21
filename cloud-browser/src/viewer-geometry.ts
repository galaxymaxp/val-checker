export type ContainedPointInput = {
  readonly containerHeight: number;
  readonly containerWidth: number;
  readonly contentHeight: number;
  readonly contentWidth: number;
  readonly localX: number;
  readonly localY: number;
};

export type ViewerKeyInput = {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly metaKey: boolean;
};

/**
 * Maps a pointer in an object-fit: contain box onto the streamed viewport.
 * The viewer can be wider or taller than the Riot frame, so clicks in the
 * letterboxed canvas must first be offset into the actual rendered image.
 */
export function normalizeContainedPoint(input: ContainedPointInput): {
  x: number;
  y: number;
} {
  const containerWidth = Math.max(1, input.containerWidth);
  const containerHeight = Math.max(1, input.containerHeight);
  const contentWidth = Math.max(1, input.contentWidth);
  const contentHeight = Math.max(1, input.contentHeight);
  const scale = Math.min(
    containerWidth / contentWidth,
    containerHeight / contentHeight,
  );
  const renderedWidth = contentWidth * scale;
  const renderedHeight = contentHeight * scale;
  const offsetX = (containerWidth - renderedWidth) / 2;
  const offsetY = (containerHeight - renderedHeight) / 2;

  return {
    x: Math.max(0, Math.min(1, (input.localX - offsetX) / renderedWidth)),
    y: Math.max(0, Math.min(1, (input.localY - offsetY) / renderedHeight)),
  };
}

/** Printable text arrives through the textarea input event. Navigation,
 * editing, and shortcut keys need key events so users can correct fields. */
export function shouldForwardViewerKey(input: ViewerKeyInput): boolean {
  return (
    input.key.length !== 1 || input.ctrlKey || input.metaKey || input.altKey
  );
}

/**
 * Fallback for browsers that leave focus on the streamed canvas. `KeyboardEvent#key`
 * already contains the shifted character, so it can be inserted verbatim.
 */
export function viewerPrintableText(input: ViewerKeyInput): string | null {
  return shouldForwardViewerKey(input) ? null : input.key;
}
