/**
 * `tavik rules` — what this workspace has said must never happen.
 *
 * Reads them from the graph rather than from a file, because that is where they
 * live: rules written on the dashboard and rules seen by CI are the same rules,
 * and a CLI that kept its own copy would eventually disagree with the product.
 */

import type { SecurityBoundary } from "../../src/lib/domain/boundary";
import { connection } from "../config";
import { bold, dim, grey, heading, line, plural } from "../output";
import { EXIT, runtime } from "../runtime";

export async function listRules(json: boolean): Promise<number> {
  const { rules } = runtime(connection());
  const declared = await rules.list();

  if (json) {
    line(JSON.stringify(declared.map(describe), null, 2));
    return EXIT.OK;
  }

  if (declared.length === 0) {
    heading("No rules yet");
    line(`  ${dim("Run `tavik scan` — a first scan brings the starter rules with it.")}`);
    line();
    return EXIT.OK;
  }

  heading(plural(declared.length, "rule"));
  line();
  for (const rule of declared) {
    line(`  ${bold(rule.name)}  ${grey(rule.id)}`);
    line(`  ${dim(rule.statement)}`);
    line(
      `  ${grey(
        `${rule.source.description} → ${rule.target.description}, ` +
          `up to ${plural(rule.maxHops, "hop")} via ${rule.relations.join(" / ").toLowerCase()}`,
      )}`,
    );
    line();
  }
  return EXIT.OK;
}

function describe(rule: SecurityBoundary) {
  return {
    id: rule.id,
    name: rule.name,
    statement: rule.statement,
    from: rule.source.description,
    to: rule.target.description,
    relations: rule.relations,
    maxHops: rule.maxHops,
  };
}
