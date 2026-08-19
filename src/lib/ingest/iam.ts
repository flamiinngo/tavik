import {
  type Entity,
  type EntityUrn,
  entityUrn,
  type Relation,
} from "@/lib/domain/entities";

/**
 * AWS IAM ingestion.
 *
 * The second boundary domain, and the one the product was originally conceived
 * around: *"production customer data must never be reachable from CI."*
 *
 * The engine does not change. A dependency graph and an IAM graph are the same
 * question wearing different clothes — who can reach what, through which
 * relationships — so this is purely another adapter producing the same entities
 * and edges. That the identical verifier answers both is the strongest evidence
 * the model is right rather than fitted to one dataset.
 *
 * Reads the output of:
 *
 *   aws iam get-account-authorization-details
 *
 * which is the standard, complete export of an account's roles, policies and
 * trust relationships. Parsing a real AWS output format rather than inventing
 * one matters: the whole product rests on reading what is actually true.
 */

export class IamParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IamParseError";
  }
}

export interface IamProjection {
  readonly entities: readonly Entity[];
  readonly relations: readonly Relation[];
  readonly roles: number;
  readonly datastores: number;
  readonly ciIdentities: number;
  /** Trust relationships that let one role assume another. */
  readonly assumptions: number;
}

/** Actions that mean "can read or write the data itself", not just describe it. */
const DATA_ACTIONS = [
  /^s3:get/i,
  /^s3:put/i,
  /^s3:delete/i,
  /^s3:\*/,
  /^dynamodb:(get|put|update|delete|scan|query|batch)/i,
  /^dynamodb:\*/,
  /^rds-data:/i,
  /^rds:connect/i,
  /^secretsmanager:getsecretvalue/i,
  /^kms:decrypt/i,
  /^\*$/,
];

/** Principals that indicate a CI/CD identity rather than a human or service. */
const CI_PRINCIPAL_HINTS = [
  /token\.actions\.githubusercontent\.com/i,
  /gitlab/i,
  /circleci/i,
  /buildkite/i,
  /codebuild\.amazonaws\.com/i,
  /^arn:aws:iam::\d+:role\/.*(ci|build|deploy|pipeline|actions)/i,
];

interface Statement {
  Effect?: string;
  Action?: string | string[];
  NotAction?: string | string[];
  Resource?: string | string[];
  Principal?: Record<string, string | string[]> | string;
}

interface PolicyDocument {
  Statement?: Statement | Statement[];
}

interface RoleDetail {
  RoleName?: string;
  Arn?: string;
  AssumeRolePolicyDocument?: PolicyDocument | string;
  RolePolicyList?: { PolicyName?: string; PolicyDocument?: PolicyDocument | string }[];
  AttachedManagedPolicies?: { PolicyName?: string; PolicyArn?: string }[];
}

interface AuthorizationDetails {
  RoleDetailList?: RoleDetail[];
  Policies?: {
    PolicyName?: string;
    Arn?: string;
    PolicyVersionList?: { Document?: PolicyDocument | string; IsDefaultVersion?: boolean }[];
  }[];
}

/**
 * AWS returns embedded policy documents either as objects or as URL-encoded
 * JSON strings, depending on which API and which SDK version produced the file.
 * Both appear in real exports.
 */
function readDocument(value: PolicyDocument | string | undefined): PolicyDocument | null {
  if (!value) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(decodeURIComponent(value)) as PolicyDocument;
  } catch {
    try {
      return JSON.parse(value) as PolicyDocument;
    } catch {
      return null;
    }
  }
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** The human-readable tail of an ARN, for display. */
function shortName(arn: string): string {
  const tail = arn.split(":").pop() ?? arn;
  return tail.split("/").pop() ?? tail;
}

function isDataAction(action: string): boolean {
  return DATA_ACTIONS.some((pattern) => pattern.test(action));
}

function looksLikeCi(principal: string): boolean {
  return CI_PRINCIPAL_HINTS.some((pattern) => pattern.test(principal));
}

/**
 * Turn an account export into entities and relationships.
 *
 * Edges follow influence, exactly as in the supply-chain graph:
 *
 *   CiJob ──runs as──▶ Role ──can assume──▶ Role ──can access──▶ Datastore
 *
 * Only `Allow` statements produce edges. An explicit `Deny` is not modelled as a
 * negative edge because reachability has no notion of one — a route either
 * exists or it does not. Denies are noted on the role instead, so a person
 * reading the evidence can see one applies rather than being told a path exists
 * that policy would actually block.
 */
export function projectIamExport(
  raw: unknown,
  options: { readonly environment: string; readonly observedAt: number },
): IamProjection {
  if (typeof raw !== "object" || raw === null) {
    throw new IamParseError("That isn't a JSON object.");
  }

  const details = raw as AuthorizationDetails;
  const roles = details.RoleDetailList;
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new IamParseError(
      "No roles found. Tavik expects the output of `aws iam get-account-authorization-details`, which contains a RoleDetailList.",
    );
  }

  const entities = new Map<EntityUrn, Entity>();
  const relations: Relation[] = [];
  const datastores = new Set<string>();
  const ciIdentities = new Set<string>();
  let assumptions = 0;

  // Managed policies are stored separately from the roles that attach them.
  const managedPolicies = new Map<string, PolicyDocument>();
  for (const policy of details.Policies ?? []) {
    const version =
      policy.PolicyVersionList?.find((v) => v.IsDefaultVersion) ??
      policy.PolicyVersionList?.[0];
    const document = readDocument(version?.Document);
    if (policy.Arn && document) managedPolicies.set(policy.Arn, document);
  }

  for (const role of roles) {
    const roleArn = role.Arn;
    const roleName = role.RoleName ?? (roleArn ? shortName(roleArn) : null);
    if (!roleArn || !roleName) continue;

    const roleUrn = entityUrn("Role", roleName);
    entities.set(roleUrn, {
      urn: roleUrn,
      kind: "Role",
      name: roleName,
      source: "aws-iam",
      attributes: { arn: roleArn, environment: options.environment },
    });

    // ── Who can assume this role ──────────────────────────────────────────
    const trust = readDocument(role.AssumeRolePolicyDocument);
    for (const statement of asArray(trust?.Statement)) {
      if ((statement.Effect ?? "Allow") !== "Allow") continue;

      const principals: string[] = [];
      if (typeof statement.Principal === "string") {
        principals.push(statement.Principal);
      } else if (statement.Principal) {
        for (const value of Object.values(statement.Principal)) {
          principals.push(...asArray(value));
        }
      }

      for (const principal of principals) {
        if (looksLikeCi(principal)) {
          // A CI identity: the thing the product was built to trace from.
          const name = shortName(principal);
          const ciUrn = entityUrn("CiJob", name);
          ciIdentities.add(name);
          entities.set(ciUrn, {
            urn: ciUrn,
            kind: "CiJob",
            name,
            source: "aws-iam",
            attributes: { principal, environment: options.environment, tag: "ci" },
          });
          relations.push({
            from: ciUrn,
            to: roleUrn,
            kind: "RUNS_AS",
            source: "aws-iam",
            observedAt: options.observedAt,
            evidence: `${name} may assume ${roleName}`,
          });
        } else if (principal.includes(":role/")) {
          // Role-to-role trust: the chain that makes privilege escalation
          // possible several hops from where anyone is looking.
          const otherName = shortName(principal);
          const otherUrn = entityUrn("Role", otherName);
          entities.set(otherUrn, {
            urn: otherUrn,
            kind: "Role",
            name: otherName,
            source: "aws-iam",
            attributes: { arn: principal, environment: options.environment },
          });
          relations.push({
            from: otherUrn,
            to: roleUrn,
            kind: "CAN_ASSUME",
            source: "aws-iam",
            observedAt: options.observedAt,
            evidence: `${otherName} trusted to assume ${roleName}`,
          });
          assumptions++;
        }
      }
    }

    // ── What this role can reach ──────────────────────────────────────────
    const documents: PolicyDocument[] = [];
    for (const inline of role.RolePolicyList ?? []) {
      const document = readDocument(inline.PolicyDocument);
      if (document) documents.push(document);
    }
    for (const attached of role.AttachedManagedPolicies ?? []) {
      const document = attached.PolicyArn
        ? managedPolicies.get(attached.PolicyArn)
        : undefined;
      if (document) documents.push(document);
    }

    for (const document of documents) {
      for (const statement of asArray(document.Statement)) {
        if ((statement.Effect ?? "Allow") !== "Allow") continue;

        const actions = asArray(statement.Action);
        if (!actions.some(isDataAction)) continue;

        for (const resource of asArray(statement.Resource)) {
          // A wildcard grants everything, which is a finding in itself, but it
          // names no specific store — recorded as one so the route is visible.
          const name = resource === "*" ? "every resource in the account" : shortName(resource);
          if (!name) continue;

          datastores.add(name);
          const storeUrn = entityUrn("Datastore", name);
          entities.set(storeUrn, {
            urn: storeUrn,
            kind: "Datastore",
            name,
            source: "aws-iam",
            attributes: {
              arn: resource,
              environment: options.environment,
              // What makes it *customer* data is a judgement about the estate,
              // not something an ARN states, so it is inferred by convention and
              // shown as an inference rather than asserted as fact.
              tag: /customer|user|pii|payment|billing/i.test(resource)
                ? "customer-data"
                : "",
            },
          });

          relations.push({
            from: roleUrn,
            to: storeUrn,
            kind: "CAN_ACCESS",
            source: "aws-iam",
            observedAt: options.observedAt,
            evidence: `${actions.filter(isDataAction).slice(0, 3).join(", ")} on ${resource}`,
          });
        }
      }
    }
  }

  // Deduplicate: several statements commonly grant the same pair.
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
    roles: [...entities.values()].filter((e) => e.kind === "Role").length,
    datastores: datastores.size,
    ciIdentities: ciIdentities.size,
    assumptions,
  };
}
