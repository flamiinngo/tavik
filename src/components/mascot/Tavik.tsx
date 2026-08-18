import Image from "next/image";

import alertPose from "../../../public/mascot/tavik-alert.png";
import analyzingPose from "../../../public/mascot/tavik-analyzing.png";
import heroPose from "../../../public/mascot/tavik-hero.png";
import profilePose from "../../../public/mascot/tavik-profile.png";
import standbyPose from "../../../public/mascot/tavik-standby.png";
import verifiedPose from "../../../public/mascot/tavik-verified.png";
import watchingPose from "../../../public/mascot/tavik-watching.png";
import workingPose from "../../../public/mascot/tavik-working.png";

/**
 * The Tavik character.
 *
 * Poses are addressed by **product state**, never by what they depict. A caller
 * asks for `verified`, not for "the one holding a shield" — so if the artwork is
 * ever redrawn, every call site stays correct and meaningful.
 *
 * Used with restraint on purpose. The brief is explicit that the mascot belongs
 * in a handful of places where it carries meaning — status, empty states,
 * onboarding, the work log — and nowhere else. Premium security products do not
 * decorate. Before adding one, ask what state it is communicating; if the answer
 * is "none", it does not belong there.
 *
 * Assets are produced from the committed character sheet by `npm run
 * mascot:slice`. They are statically imported so Next.js can supply intrinsic
 * dimensions and a blur placeholder, which keeps the mascot from causing layout
 * shift as it loads.
 */
export type TavikPose =
  /** Marketing hero. Standing, authoritative. */
  | "hero"
  /** Work in progress: ingestion, analysis, verification runs. */
  | "analyzing"
  /** A boundary is violated. Alert, crouched. */
  | "alert"
  /** Steady state on the dashboard. Watching, arms crossed. */
  | "watching"
  /** Nothing to do yet. Empty states and onboarding. */
  | "standby"
  /** Small avatar for notifications and log headers. */
  | "profile"
  /** The work log. Seated, working. */
  | "working"
  /** A boundary is verified. Holding a shield. */
  | "verified";

const POSES = {
  hero: {
    src: heroPose,
    alt: "Tavik, standing with a confident posture",
  },
  analyzing: {
    src: analyzingPose,
    alt: "Tavik, moving forward while analysing the environment",
  },
  alert: {
    src: alertPose,
    alt: "Tavik, alert after detecting a boundary violation",
  },
  watching: {
    src: watchingPose,
    alt: "Tavik, arms crossed, watching the environment",
  },
  standby: {
    src: standbyPose,
    alt: "Tavik, standing by with nothing to verify yet",
  },
  profile: {
    src: profilePose,
    alt: "Tavik, side profile",
  },
  working: {
    src: workingPose,
    alt: "Tavik, seated at a laptop, working",
  },
  verified: {
    src: verifiedPose,
    alt: "Tavik, holding a shield, boundary verified",
  },
} as const satisfies Record<TavikPose, { src: unknown; alt: string }>;

/**
 * Rendered widths, in pixels.
 *
 * A fixed scale rather than arbitrary sizes, so the character never appears at
 * two slightly different sizes on the same screen — the kind of inconsistency
 * that reads as sloppiness even when nobody can name it.
 */
export const TAVIK_SIZES = {
  /** Inline with text: notification rows, log headers. */
  xs: 28,
  /** Beside a heading or a status line. */
  sm: 48,
  /** Cards, panels, inline empty states. */
  md: 96,
  /** Full-panel empty states, onboarding steps. */
  lg: 160,
  /** Hero and major moments. Use once per screen at most. */
  xl: 260,
} as const;

export type TavikSize = keyof typeof TAVIK_SIZES;

export interface TavikProps {
  pose: TavikPose;
  size?: TavikSize;
  /**
   * Overrides the pose's default alt text. Pass an empty string when the
   * character is purely decorative and adjacent text already conveys the state —
   * repeating it only makes a screen reader more verbose, not more useful.
   */
  alt?: string;
  /** Set on above-the-fold instances so they are not lazy-loaded. */
  priority?: boolean;
  className?: string;
}

export function Tavik({
  pose,
  size = "md",
  alt,
  priority = false,
  className,
}: TavikProps) {
  const { src, alt: defaultAlt } = POSES[pose];
  const width = TAVIK_SIZES[size];

  return (
    <Image
      src={src}
      alt={alt ?? defaultAlt}
      // Only `width` is given. The poses are not all the same shape, so pinning
      // both dimensions would distort them; with a static import Next.js derives
      // the height from the asset's intrinsic ratio.
      width={width}
      style={{ width, height: "auto" }}
      priority={priority}
      // A blur placeholder on a 28px avatar costs more than the image it stands
      // in for, so it is only used where the character is large enough for the
      // load-in to actually be visible.
      placeholder={width >= 96 ? "blur" : undefined}
      className={className}
      draggable={false}
    />
  );
}
