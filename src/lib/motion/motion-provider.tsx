"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

export interface MotionProviderProps {
  readonly children: ReactNode;
}

/**
 * Wraps the tree in a MotionConfig that honors the user's OS-level
 * reduced-motion preference for every motion component beneath it.
 */
export function MotionProvider({ children }: MotionProviderProps) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
