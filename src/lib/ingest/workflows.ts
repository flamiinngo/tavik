import {
  type Entity,
  type EntityUrn,
  entityUrn,
  type Relation,
} from "@/lib/domain/entities";
import type { WorkflowAction } from "./github";

/**
 * Projecting CI workflows into the security graph.
 *
 * The chain mirrors the dependency one, because the risk has the same shape:
 *
 *   Publisher ──maintains──▶ Action ──supplies──▶ Workflow ──supplies──▶ Service
 *
 * Read in influence order: whoever controls `actions/checkout` controls code
 * that runs in every workflow using it, and those workflows build and deploy the
 * service. Using the same relationship vocabulary is what lets one rule cover
 * both surfaces — "nobody outside our list should reach production" is answered
 * across dependencies *and* CI without knowing they are different things.
 *
 * A version reference of `unpinned`, or a mutable tag like `v3`, means the code
 * that runs tomorrow need not be the code that ran today. That is recorded as an
 * attribute rather than judged here; whether it matters is a rule's business.
 */

export interface WorkflowProjection {
  readonly entities: readonly Entity[];
  readonly relations: readonly Relation[];
  readonly actionCount: number;
  readonly publisherCount: number;
  /** Actions pinned to a mutable reference rather than a commit. */
  readonly unpinnedCount: number;
}

/** A 40-character hex string is a commit sha; anything else can move. */
function isPinnedToCommit(version: string): boolean {
  return /^[0-9a-f]{40}$/i.test(version);
}

export function projectWorkflows(
  actions: readonly WorkflowAction[],
  options: {
    readonly serviceUrn: EntityUrn;
    readonly observedAt: number;
    readonly trustedPublishers: ReadonlySet<string>;
  },
): WorkflowProjection {
  const entities = new Map<EntityUrn, Entity>();
  const relations: Relation[] = [];
  const publishers = new Set<string>();
  const seenActions = new Set<string>();
  let unpinnedCount = 0;

  for (const action of actions) {
    const [owner] = action.action.split("/");
    if (!owner) continue;

    const workflowUrn = entityUrn("Workflow", action.workflow);
    const actionUrn = entityUrn("Action", action.action);
    const publisherUrn = entityUrn("Maintainer", owner);

    seenActions.add(action.action);
    publishers.add(owner);
    if (!isPinnedToCommit(action.version)) unpinnedCount++;

    entities.set(workflowUrn, {
      urn: workflowUrn,
      kind: "Workflow",
      name: action.workflow,
      source: "lockfile",
    });

    entities.set(actionUrn, {
      urn: actionUrn,
      kind: "Action",
      name: `${action.action}@${action.version}`,
      displayName: action.action,
      source: "npm-registry",
      attributes: {
        version: action.version,
        pinnedToCommit: isPinnedToCommit(action.version),
      },
    });

    // The GitHub account behind the action. Trust is this workspace's own
    // policy, exactly as with npm publishers, and says nothing about anyone.
    entities.set(publisherUrn, {
      urn: publisherUrn,
      kind: "Maintainer",
      name: owner,
      source: "npm-registry",
      attributes: {
        trust: options.trustedPublishers.has(owner) ? "trusted" : "untrusted",
        registry: "github.com",
      },
    });

    relations.push(
      {
        from: publisherUrn,
        to: actionUrn,
        kind: "MAINTAINS",
        source: "lockfile",
        observedAt: options.observedAt,
        evidence: `publishes github.com/${action.action}`,
      },
      {
        from: actionUrn,
        to: workflowUrn,
        kind: "SUPPLIES",
        source: "lockfile",
        observedAt: options.observedAt,
        evidence: `used by ${action.workflow}`,
      },
      {
        from: workflowUrn,
        to: options.serviceUrn,
        kind: "SUPPLIES",
        source: "lockfile",
        observedAt: options.observedAt,
        evidence: `${action.workflow} builds this service`,
      },
    );
  }

  // Deduplicate: the same workflow uses many actions, and many workflows share
  // the same action, so the same edge is produced repeatedly.
  const seen = new Set<string>();
  const deduped = relations.filter((relation) => {
    const key = `${relation.from}|${relation.kind}|${relation.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    entities: [...entities.values()],
    relations: deduped,
    actionCount: seenActions.size,
    publisherCount: publishers.size,
    unpinnedCount,
  };
}
