import { randomUUID } from "node:crypto";

import type { EntitySelector, SecurityBoundary } from "@/lib/domain/boundary";
import type { RelationKind } from "@/lib/domain/entities";
import { isRelationKind } from "@/lib/domain/entities";
import type { HydraClient, HydraParam, QueryOptions } from "@/lib/hydra/client";
import { identifier } from "@/lib/hydra/cypher";
import { urnToNodeId } from "@/lib/hydra/node-id";

/**
 * Rules that people write, stored in HydraDB.
 *
 * Rules used to live in a TypeScript constant, which meant the product could
 * only ever answer questions we had thought of in advance. A security rule is
 * something a team decides, so it has to be authored, saved and edited by them —
 * otherwise this is a demo of an engine rather than a product.
 *
 * Stored under their own `Rule` label, kept out of the `Entity` label that holds
 * security state. Traversal is keyed on `sourceLabel: 'Entity'` and an explicit
 * relationship allowlist, so a saved rule can never appear inside the graph it
 * is asking about.
 */

const RULE_LABEL = "Rule";

interface RuleRow {
  rule_id?: unknown;
  name?: unknown;
  statement?: unknown;
  source_kind?: unknown;
  source_property?: unknown;
  source_value?: unknown;
  source_description?: unknown;
  target_kind?: unknown;
  target_property?: unknown;
  target_value?: unknown;
  target_description?: unknown;
  relations?: unknown;
  max_hops?: unknown;
  created_at?: unknown;
  environment_id?: unknown;
  [column: string]: unknown;
}

export class RuleStore {
  constructor(private readonly client: HydraClient) {}

  /** Save a rule. Re-saving the same id updates it in place. */
  async save(boundary: SecurityBoundary, options: QueryOptions = {}): Promise<void> {
    const label = identifier(RULE_LABEL);

    await this.client.query(
      `UNWIND $rows AS row
       MERGE (n {id: row.id})
       SET n:${label.text}, n.rule_id = row.rule_id, n.name = row.name,
           n.statement = row.statement,
           n.source_kind = row.source_kind, n.source_property = row.source_property,
           n.source_value = row.source_value, n.source_description = row.source_description,
           n.target_kind = row.target_kind, n.target_property = row.target_property,
           n.target_value = row.target_value, n.target_description = row.target_description,
           n.relations = row.relations, n.max_hops = row.max_hops,
           n.created_at = row.created_at, n.environment_id = row.environment_id`,
      {
        ...options,
        parameters: {
          rows: [
            {
              id: urnToNodeId(`tavik:rule:${boundary.id}`),
              rule_id: boundary.id,
              name: boundary.name,
              statement: boundary.statement,
              source_kind: boundary.source.kind,
              source_property: boundary.source.property,
              source_value: boundary.source.value,
              source_description: boundary.source.description,
              target_kind: boundary.target.kind,
              target_property: boundary.target.property,
              target_value: boundary.target.value,
              target_description: boundary.target.description,
              // Stored as a delimited string: HydraDB property values are
              // scalars, so a list has to be flattened somewhere.
              relations: boundary.relations.join(","),
              max_hops: boundary.maxHops,
              created_at: boundary.createdAt,
              environment_id: boundary.environmentId,
            },
          ] as unknown as HydraParam,
        },
      },
    );
  }

  async list(options: QueryOptions = {}): Promise<SecurityBoundary[]> {
    const label = identifier(RULE_LABEL);
    const result = await this.client.query<RuleRow>(
      `MATCH (r:${label.text})
       RETURN r.rule_id AS rule_id, r.name AS name, r.statement AS statement,
              r.source_kind AS source_kind, r.source_property AS source_property,
              r.source_value AS source_value, r.source_description AS source_description,
              r.target_kind AS target_kind, r.target_property AS target_property,
              r.target_value AS target_value, r.target_description AS target_description,
              r.relations AS relations, r.max_hops AS max_hops,
              r.created_at AS created_at, r.environment_id AS environment_id`,
      options,
    );

    return result.rows
      .map(toBoundary)
      .filter((rule): rule is SecurityBoundary => rule !== null)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async remove(ruleId: string, options: QueryOptions = {}): Promise<void> {
    await this.client.query("MATCH (n {id: $id}) DETACH DELETE n", {
      ...options,
      parameters: { id: urnToNodeId(`tavik:rule:${ruleId}`) },
    });
  }
}

/** A readable id derived from the rule's name, so URLs mean something. */
export function ruleIdFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? slug : `rule-${randomUUID().slice(0, 8)}`;
}

function toBoundary(row: RuleRow): SecurityBoundary | null {
  const id = row.rule_id;
  if (typeof id !== "string" || id.length === 0) return null;

  const relations = String(row.relations ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is RelationKind => isRelationKind(value));

  if (relations.length === 0) return null;

  const source = toSelector(
    row.source_kind,
    row.source_property,
    row.source_value,
    row.source_description,
  );
  const target = toSelector(
    row.target_kind,
    row.target_property,
    row.target_value,
    row.target_description,
  );
  if (!source || !target) return null;

  const maxHops = Number(row.max_hops);

  return {
    id,
    name: String(row.name ?? id),
    statement: String(row.statement ?? ""),
    source,
    target,
    relations,
    maxHops: Number.isFinite(maxHops) && maxHops > 0 ? maxHops : 8,
    createdAt: Number(row.created_at) || 0,
    environmentId: String(row.environment_id ?? "env-local"),
  };
}

function toSelector(
  kind: unknown,
  property: unknown,
  value: unknown,
  description: unknown,
): EntitySelector | null {
  if (typeof kind !== "string" || typeof property !== "string") return null;
  return {
    kind: kind as EntitySelector["kind"],
    property: property as EntitySelector["property"],
    value: String(value ?? ""),
    description: String(description ?? ""),
  };
}
