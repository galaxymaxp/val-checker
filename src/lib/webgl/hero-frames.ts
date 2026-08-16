/**
 * Pinned hero renders for the skin morph substrate. The assets in
 * public/hero are produced by `pnpm hero:renders`; the dimensions below are
 * the actual transcoded output sizes that script reports.
 */

export interface HeroFrame {
  readonly height: number;
  readonly id: string;
  readonly label: string;
  readonly src: string;
  readonly tierColor: readonly [number, number, number];
  readonly width: number;
}

export const HERO_FRAMES: readonly HeroFrame[] = [
  {
    height: 370,
    id: "prime-vandal",
    label: "Prime Vandal",
    src: "/hero/prime-vandal.webp",
    tierColor: [1.0, 0.78, 0.35],
    width: 1280,
  },
  {
    height: 390,
    id: "reaver-vandal",
    label: "Reaver Vandal",
    src: "/hero/reaver-vandal.webp",
    tierColor: [0.72, 0.45, 1.0],
    width: 1280,
  },
  {
    height: 290,
    id: "oni-phantom",
    label: "Oni Phantom",
    src: "/hero/oni-phantom.webp",
    tierColor: [1.0, 0.35, 0.42],
    width: 1280,
  },
  {
    height: 360,
    id: "glitchpop-vandal",
    label: "Glitchpop Vandal",
    src: "/hero/glitchpop-vandal.webp",
    tierColor: [1.0, 0.3, 0.85],
    width: 1280,
  },
  {
    height: 290,
    id: "ion-phantom",
    label: "Ion Phantom",
    src: "/hero/ion-phantom.webp",
    tierColor: [0.4, 0.85, 1.0],
    width: 1280,
  },
  {
    height: 370,
    id: "araxys-vandal",
    label: "Araxys Vandal",
    src: "/hero/araxys-vandal.webp",
    tierColor: [0.35, 1.0, 0.75],
    width: 1280,
  },
];
