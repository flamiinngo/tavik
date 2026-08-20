/**
 * Server-side configuration.
 *
 * Every value here is server-only. Nothing in this module may be imported from a
 * client component: the HydraDB token must never be serialised into the browser
 * bundle. Values are read lazily so that `next build` does not require a running
 * database or a populated `.env.local`.
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new ConfigError(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env.local and run \`npm run hydra:setup\`.`,
    );
  }
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(
      `Environment variable ${name} must be a positive integer, got ${JSON.stringify(raw)}.`,
    );
  }
  return parsed;
}

export interface HydraEnv {
  readonly baseUrl: string;
  readonly token: string;
  readonly graphId: string;
  readonly namespace: string;
  readonly cellId: string;
  readonly timeoutMs: number;
}

export function hydraEnv(): HydraEnv {
  return {
    baseUrl: required("HYDRA_URL", "http://127.0.0.1:8443"),
    token: required("HYDRA_TOKEN"),
    graphId: required("HYDRA_GRAPH_ID", "default"),
    namespace: required("HYDRA_NAMESPACE", "default"),
    cellId: required("HYDRA_CELL_ID", "cell-0"),
    timeoutMs: integer("HYDRA_TIMEOUT_MS", 30_000),
  };
}

/**
 * True when this is the public demo rather than somebody's own install.
 *
 * Changes two things and nothing else: a stranger gets one line explaining what
 * they are looking at, and a database that is not answering is described as
 * probably hibernating rather than probably broken — which on a free plan that
 * sleeps after fifteen minutes is simply the more likely explanation.
 *
 * Off by default. Someone running Tavik on their own machine does not need a
 * caption on their own dashboard.
 */
export function isPublicDemo(): boolean {
  return process.env.TAVIK_PUBLIC_DEMO === "true";
}

/** True when Tavik should surface the labelled demo environment controls. */
export function demoModeEnabled(): boolean {
  return process.env.TAVIK_DEMO_MODE !== "false";
}
