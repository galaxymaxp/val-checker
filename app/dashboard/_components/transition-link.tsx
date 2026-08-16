"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";

import { prefersReducedMotion } from "@/src/lib/motion/reduced-motion";

interface TransitionLinkProps
  extends Omit<ComponentProps<typeof Link>, "href" | "onClick"> {
  readonly href: string;
}

/**
 * The app router, or null where none is mounted (component tests render
 * without one). Without a router the component is just a plain link.
 */
function useOptionalRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

/**
 * A next/link that wraps in-app navigation in a view transition when the
 * browser supports it and the user has not asked for reduced motion. The
 * snapshot is taken before the async navigation resolves, so this produces a
 * quick crossfade rather than a tracked morph — acceptable, and additive:
 * modified clicks, middle clicks, and unsupported browsers all fall through
 * to the plain link.
 */
export function TransitionLink({ href, ...rest }: TransitionLinkProps) {
  const router = useOptionalRouter();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    const plainLeftClick =
      event.button === 0 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey;

    if (
      !router ||
      !plainLeftClick ||
      typeof document.startViewTransition !== "function" ||
      prefersReducedMotion()
    ) {
      return;
    }

    event.preventDefault();
    document.startViewTransition(() => {
      router.push(href);
    });
  }

  return <Link {...rest} href={href} onClick={handleClick} />;
}
