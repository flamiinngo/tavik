/**
 * The application's navigation, in one place.
 *
 * Shared because there are two of them: a sidebar on a wide screen and a panel
 * on a narrow one. Two hand-maintained copies of a nav is how a screen ends up
 * reachable on a laptop and invisible on a phone, which is exactly the bug this
 * file was extracted to fix.
 *
 * Every item here is built and works. `ready` stays on each entry rather than
 * being deleted now they are all true: a nav that silently omits an unfinished
 * screen makes it impossible to tell scope from progress, and the next screen
 * added should have to declare itself either way.
 */

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly ready: boolean;
}

export interface NavSection {
  readonly heading: string;
  readonly items: readonly NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    // What is true right now, and how it got that way. Where someone spends
    // their time once Tavik is running.
    heading: "What's true now",
    items: [
      { href: "/app", label: "Overview", ready: true },
      { href: "/app/boundaries", label: "Rules", ready: true },
      { href: "/app/publishers", label: "Publishers", ready: true },
      { href: "/app/graph", label: "Security graph", ready: true },
      { href: "/app/timeline", label: "Timeline", ready: true },
      { href: "/app/work-log", label: "Work log", ready: true },
    ],
  },
  {
    // Everything that decides what Tavik watches and how. Separated because a
    // flat list of ten made the product read as ten features rather than one
    // thing with a setup and a state.
    heading: "Setup",
    items: [
      { href: "/app/onboarding", label: "Get started", ready: true },
      { href: "/app/watches", label: "Watched repos", ready: true },
      { href: "/app/integrations", label: "Integrations", ready: true },
      { href: "/app/team", label: "Team", ready: true },
    ],
  },
];
