import { describe, expect, it } from "vitest";
import { IamParseError, projectIamExport } from "./iam";

/**
 * IAM parsing decides whether Tavik can see a route from CI to your data. A
 * misparse doesn't crash — it produces a smaller graph, and every rule then
 * reports "no way in" with total confidence. That failure looks exactly like
 * safety, which makes it the most dangerous thing this file can do.
 *
 * The fixtures use the real shapes AWS emits, including the ones that vary
 * between SDK versions.
 */

const OPTIONS = { environment: "production", observedAt: 1_755_000_000_000 };

/** A trust policy naming GitHub Actions as the principal. */
const githubTrust = {
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: { Federated: "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" },
      Action: "sts:AssumeRoleWithWebIdentity",
    },
  ],
};

const readCustomerBucket = {
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Action: ["s3:GetObject", "s3:PutObject"],
      Resource: "arn:aws:s3:::acme-customer-records/*",
    },
  ],
};

describe("projectIamExport", () => {
  it("rejects anything that isn't an account export", () => {
    expect(() => projectIamExport({ hello: "world" }, OPTIONS)).toThrow(IamParseError);
    expect(() => projectIamExport("nope", OPTIONS)).toThrow(IamParseError);
  });

  it("names the expected command when the shape is wrong", () => {
    // The error has to say what to run, or someone is left guessing which of
    // several AWS exports Tavik wants.
    try {
      projectIamExport({ RoleDetailList: [] }, OPTIONS);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toMatch(/get-account-authorization-details/);
    }
  });

  it("maps a CI identity through a role to a data store", () => {
    const projection = projectIamExport(
      {
        RoleDetailList: [
          {
            RoleName: "deploy",
            Arn: "arn:aws:iam::123456789012:role/deploy",
            AssumeRolePolicyDocument: githubTrust,
            RolePolicyList: [
              { PolicyName: "data", PolicyDocument: readCustomerBucket },
            ],
          },
        ],
      },
      OPTIONS,
    );

    const kinds = projection.entities.map((e) => e.kind).sort();
    expect(kinds).toContain("CiJob");
    expect(kinds).toContain("Role");
    expect(kinds).toContain("Datastore");

    const relations = projection.relations.map((r) => r.kind);
    expect(relations).toContain("RUNS_AS");
    expect(relations).toContain("CAN_ACCESS");
    expect(projection.ciIdentities).toBe(1);
  });

  it("reads a policy document delivered as a URL-encoded string", () => {
    // AWS returns these either as objects or as encoded strings depending on
    // the SDK. Handling only one silently loses every route in the other.
    const projection = projectIamExport(
      {
        RoleDetailList: [
          {
            RoleName: "deploy",
            Arn: "arn:aws:iam::123456789012:role/deploy",
            AssumeRolePolicyDocument: encodeURIComponent(JSON.stringify(githubTrust)),
            RolePolicyList: [
              {
                PolicyName: "data",
                PolicyDocument: encodeURIComponent(JSON.stringify(readCustomerBucket)),
              },
            ],
          },
        ],
      },
      OPTIONS,
    );

    expect(projection.ciIdentities).toBe(1);
    expect(projection.datastores).toBe(1);
  });

  it("follows role-to-role trust, which is how escalation hides", () => {
    const projection = projectIamExport(
      {
        RoleDetailList: [
          {
            RoleName: "prod-admin",
            Arn: "arn:aws:iam::123456789012:role/prod-admin",
            AssumeRolePolicyDocument: {
              Statement: [
                {
                  Effect: "Allow",
                  Principal: { AWS: "arn:aws:iam::123456789012:role/deploy" },
                  Action: "sts:AssumeRole",
                },
              ],
            },
            RolePolicyList: [{ PolicyName: "d", PolicyDocument: readCustomerBucket }],
          },
          {
            RoleName: "deploy",
            Arn: "arn:aws:iam::123456789012:role/deploy",
            AssumeRolePolicyDocument: githubTrust,
          },
        ],
      },
      OPTIONS,
    );

    // CI runs as deploy, deploy can assume prod-admin, prod-admin reads the
    // bucket. No single policy shows that; the chain is the finding.
    expect(projection.relations.map((r) => r.kind)).toContain("CAN_ASSUME");
    expect(projection.assumptions).toBe(1);
    expect(projection.ciIdentities).toBe(1);
  });

  it("resolves managed policies attached by ARN", () => {
    const projection = projectIamExport(
      {
        RoleDetailList: [
          {
            RoleName: "deploy",
            Arn: "arn:aws:iam::123456789012:role/deploy",
            AssumeRolePolicyDocument: githubTrust,
            AttachedManagedPolicies: [
              { PolicyName: "DataAccess", PolicyArn: "arn:aws:iam::aws:policy/DataAccess" },
            ],
          },
        ],
        Policies: [
          {
            PolicyName: "DataAccess",
            Arn: "arn:aws:iam::aws:policy/DataAccess",
            PolicyVersionList: [
              { Document: readCustomerBucket, IsDefaultVersion: true },
            ],
          },
        ],
      },
      OPTIONS,
    );

    // Managed policies live in a separate list. Ignoring them would miss most
    // real-world access, since teams attach far more than they inline.
    expect(projection.datastores).toBe(1);
  });

  it("ignores actions that only describe rather than read", () => {
    const projection = projectIamExport(
      {
        RoleDetailList: [
          {
            RoleName: "auditor",
            Arn: "arn:aws:iam::123456789012:role/auditor",
            AssumeRolePolicyDocument: githubTrust,
            RolePolicyList: [
              {
                PolicyName: "list",
                PolicyDocument: {
                  Statement: [
                    {
                      Effect: "Allow",
                      Action: ["s3:ListBucket", "s3:GetBucketLocation"],
                      Resource: "arn:aws:s3:::acme-customer-records",
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      OPTIONS,
    );

    // Listing a bucket is not reading its contents. Treating it as data access
    // would report a route that cannot actually reach the data.
    expect(projection.datastores).toBe(0);
  });

  it("does not create edges from Deny statements", () => {
    const projection = projectIamExport(
      {
        RoleDetailList: [
          {
            RoleName: "deploy",
            Arn: "arn:aws:iam::123456789012:role/deploy",
            AssumeRolePolicyDocument: githubTrust,
            RolePolicyList: [
              {
                PolicyName: "denied",
                PolicyDocument: {
                  Statement: [
                    {
                      Effect: "Deny",
                      Action: ["s3:GetObject"],
                      Resource: "arn:aws:s3:::acme-customer-records/*",
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      OPTIONS,
    );

    // Reachability has no notion of a negative edge. A Deny must not produce
    // one, or Tavik would report a route that policy actually blocks.
    expect(projection.datastores).toBe(0);
  });

  it("tags stores whose names suggest customer data", () => {
    const projection = projectIamExport(
      {
        RoleDetailList: [
          {
            RoleName: "deploy",
            Arn: "arn:aws:iam::123456789012:role/deploy",
            AssumeRolePolicyDocument: githubTrust,
            RolePolicyList: [{ PolicyName: "d", PolicyDocument: readCustomerBucket }],
          },
        ],
      },
      OPTIONS,
    );

    const store = projection.entities.find((e) => e.kind === "Datastore");
    // An inference from naming, not a fact an ARN states — but the rule about
    // customer data has to match on something.
    expect(store?.attributes?.tag).toBe("customer-data");
  });

  it("records a wildcard resource rather than dropping it", () => {
    const projection = projectIamExport(
      {
        RoleDetailList: [
          {
            RoleName: "admin",
            Arn: "arn:aws:iam::123456789012:role/admin",
            AssumeRolePolicyDocument: githubTrust,
            RolePolicyList: [
              {
                PolicyName: "all",
                PolicyDocument: {
                  Statement: [{ Effect: "Allow", Action: "*", Resource: "*" }],
                },
              },
            ],
          },
        ],
      },
      OPTIONS,
    );

    // A wildcard grants everything and names nothing. Dropping it would hide
    // the broadest possible access.
    expect(projection.datastores).toBe(1);
    expect(
      projection.entities.find((e) => e.kind === "Datastore")?.name,
    ).toBe("every resource in the account");
  });

  it("deduplicates repeated grants", () => {
    const projection = projectIamExport(
      {
        RoleDetailList: [
          {
            RoleName: "deploy",
            Arn: "arn:aws:iam::123456789012:role/deploy",
            AssumeRolePolicyDocument: githubTrust,
            RolePolicyList: [
              { PolicyName: "a", PolicyDocument: readCustomerBucket },
              { PolicyName: "b", PolicyDocument: readCustomerBucket },
            ],
          },
        ],
      },
      OPTIONS,
    );

    const access = projection.relations.filter((r) => r.kind === "CAN_ACCESS");
    expect(access).toHaveLength(1);
  });
});
