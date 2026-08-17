/**
 * Mapping Tavik's URNs onto HydraDB's integer node ids.
 *
 * HydraDB identifies nodes by an integer `id` property — `CREATE` and `MERGE`
 * are both refused without one — while Tavik's natural identity is a URN string
 * like `tavik:release:left-pad:1.3.0`. Something has to bridge the two.
 *
 * A deterministic hash is used rather than a counter or a lookup table, because
 * ingestion has to be **idempotent and resumable**: re-ingesting the same
 * lockfile must converge on the same nodes, and a partial run must be safe to
 * repeat. A counter would require a persisted allocation table and a read before
 * every write; a hash needs neither, and the same URN always lands on the same
 * id from any process, in any order.
 *
 * The cost is collision risk, which is handled explicitly rather than ignored —
 * see {@link detectCollisions}. A collision would silently merge two unrelated
 * entities, and in a reachability graph that fabricates paths that do not exist.
 * That is a correctness bug of exactly the kind this product cannot ship, so it
 * is detected rather than assumed away.
 */

import type { EntityUrn } from "@/lib/domain/entities";

/**
 * Bits of hash space used.
 *
 * JavaScript integers are exact to 2^53. 52 bits keeps the value comfortably
 * inside that and positive. With 52 bits, the probability of any collision
 * across n entities is roughly n^2 / 2^53: about 1 in 9 million at 100k
 * entities, and still under 0.06% at 1 million. Small, but not zero — hence the
 * check.
 */
const ID_BITS = 52n;
const ID_MASK = (1n << ID_BITS) - 1n;

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const U64_MASK = (1n << 64n) - 1n;

/**
 * FNV-1a over the URN's UTF-8 bytes, folded into the safe integer range.
 *
 * FNV-1a is not a cryptographic hash and does not need to be: nothing here
 * depends on preimage resistance. It is chosen for being dependency-free,
 * deterministic across runtimes, and well distributed over short ASCII strings,
 * which is exactly what URNs are.
 */
export function urnToNodeId(urn: string): number {
  const bytes = new TextEncoder().encode(urn);
  let hash = FNV_OFFSET_BASIS;

  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & U64_MASK;
  }

  // Fold the high bits down so all 64 bits of entropy reach the retained range.
  const folded = (hash ^ (hash >> ID_BITS)) & ID_MASK;

  // Zero is reserved so a missing or defaulted id is never a valid node.
  return Number(folded === 0n ? 1n : folded);
}

export interface Collision {
  readonly id: number;
  readonly urns: readonly string[];
}

/**
 * Find URNs that hash to the same node id.
 *
 * Ingestion calls this before writing. It is cheap — one pass over the batch —
 * and turns a silent, near-undetectable graph corruption into a loud failure at
 * the point of ingestion, where the offending URNs can be named.
 */
export function detectCollisions(
  urns: Iterable<EntityUrn | string>,
): Collision[] {
  const byId = new Map<number, Set<string>>();

  for (const urn of urns) {
    const id = urnToNodeId(String(urn));
    const existing = byId.get(id);
    if (existing) existing.add(String(urn));
    else byId.set(id, new Set([String(urn)]));
  }

  const collisions: Collision[] = [];
  for (const [id, set] of byId) {
    if (set.size > 1) collisions.push({ id, urns: [...set] });
  }
  return collisions;
}

export class NodeIdCollisionError extends Error {
  constructor(readonly collisions: readonly Collision[]) {
    super(
      `Refusing to ingest: ${collisions.length} node id collision(s) detected. ` +
        `Two distinct entities would be merged into one node, fabricating graph ` +
        `paths that do not exist. Colliding URNs: ` +
        collisions
          .map((c) => `id ${c.id} <- ${c.urns.join(", ")}`)
          .join("; "),
    );
    this.name = "NodeIdCollisionError";
  }
}
