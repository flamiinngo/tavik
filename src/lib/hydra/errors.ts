/**
 * HydraDB error taxonomy.
 *
 * These are distinguished because Tavik reacts to them differently. A transport
 * or protocol failure means the security state could not be read at all, and the
 * affected boundaries must be reported as `unknown` — never as `verified`. A
 * query error is a bug in Tavik and should surface loudly in development.
 */

export abstract class HydraError extends Error {
  abstract readonly kind: "query" | "protocol";
}

export interface HydraQueryErrorContext {
  readonly status?: number;
  readonly cypher?: string;
  readonly responseBody?: string;
  readonly cause?: unknown;
}

export class HydraQueryError extends HydraError {
  readonly kind = "query" as const;
  readonly status?: number;
  readonly cypher?: string;
  readonly responseBody?: string;

  constructor(message: string, context: HydraQueryErrorContext = {}) {
    super(message, { cause: context.cause });
    this.name = "HydraQueryError";
    this.status = context.status;
    this.cypher = context.cypher;
    this.responseBody = context.responseBody;
  }

  /**
   * Operator-facing detail. Includes the statement, which is safe here because
   * Tavik's Cypher contains only public infrastructure identifiers — never
   * credentials.
   */
  get detail(): string {
    const parts: string[] = [];
    if (this.status !== undefined) parts.push(`status=${this.status}`);
    if (this.responseBody) parts.push(`body=${this.responseBody.slice(0, 800)}`);
    if (this.cypher) parts.push(`query=${this.cypher.slice(0, 800)}`);
    return parts.join("\n");
  }
}

export class HydraProtocolError extends HydraError {
  readonly kind = "protocol" as const;
  constructor(message: string) {
    super(message);
    this.name = "HydraProtocolError";
  }
}
