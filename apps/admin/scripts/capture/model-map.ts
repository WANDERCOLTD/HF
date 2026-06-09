/**
 * model-map.ts — Structural-fact generator for the HF knowledge base.
 *
 * Parses prisma/schema.prisma and emits docs/kb/generated/model-map.json: a
 * first-pass classification of every model into `tenant-scoped` / `global` / `join`,
 * plus a tenant-hint flag (does the model already carry an org/tenant FK?).
 *
 * This is Tier-2 (generated) KB content — see docs/kb/README.md.
 *   - NEVER hand-edit the JSON. Re-run this script.
 *   - The `proposedClass` is a HEURISTIC. `reviewed:false` means a human has not
 *     ratified it. Multi-tenancy worklist = ratify every row, then this file is
 *     the authoritative tenant-scoping map.
 *
 * Run:  npx tsx scripts/capture/model-map.ts        (from apps/admin)
 * CI:   re-run and `git diff --exit-code` the JSON to catch schema drift.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../../..");
const SCHEMA_PATH = resolve(REPO_ROOT, "apps/admin/prisma/schema.prisma");
const OUT_PATH = resolve(REPO_ROOT, "docs/kb/generated/model-map.json");

const PRISMA_SCALARS = new Set([
  "String", "Int", "Boolean", "DateTime", "Float", "Decimal", "BigInt", "Bytes", "Json",
]);

// Models that are platform/global config, not tenant data. Seed list + patterns.
// Low-confidence heuristic — humans ratify in the JSON.
const GLOBAL_NAME_PATTERNS = [
  /^Spec/, /Spec$/, /DataContract/, /^Pipeline/, /^System/, /Config$/,
  /^Ntee/, /Reference$/, /^Feature/, /Template$/, /Registry$/,
];

// Field names that signal the model is ALREADY tenant-aware.
const TENANT_HINT = /^(org|organization|tenant|account|workspace|company)(Id)?$/i;

type Field = { name: string; type: string; isScalar: boolean; isFk: boolean; isRelation: boolean };
type ModelInfo = {
  name: string;
  fieldCount: number;
  relationCount: number;
  meaningfulScalarCount: number;
  scalarFields: string[];
  relations: { field: string; target: string }[];
  blockAttrs: string[];
  hasTenantHint: boolean;
  proposedClass: "tenant-scoped" | "global" | "join";
  confidence: "low" | "medium";
  reviewed: boolean;
  notes: string;
};

function collectEnums(src: string): Set<string> {
  const enums = new Set<string>();
  const re = /^enum\s+(\w+)\s*\{/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) enums.add(m[1]);
  return enums;
}

const IGNORED_SCALARS = new Set(["id", "createdAt", "updatedAt", "deletedAt", "validUntil"]);

function parseModel(name: string, body: string, scalarTypes: Set<string>): ModelInfo {
  const fields: Field[] = [];
  const blockAttrs: string[] = [];

  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("@@")) {
      blockAttrs.push(line.split(/\s|\(/)[0]); // @@unique, @@index, @@map ...
      continue;
    }
    const tokens = line.split(/\s+/);
    if (tokens.length < 2) continue;
    const fieldName = tokens[0];
    if (!/^[a-z_]\w*$/i.test(fieldName)) continue;
    const bareType = tokens[1].replace(/[?\[\]]/g, "");
    const isScalar = scalarTypes.has(bareType);
    const isRelation = !isScalar && /^[A-Z]/.test(bareType);
    const isFk = isScalar && /Id$/.test(fieldName);
    fields.push({ name: fieldName, type: bareType, isScalar, isFk, isRelation });
  }

  const relations = fields.filter((f) => f.isRelation).map((f) => ({ field: f.name, target: f.type }));
  const scalarFields = fields.filter((f) => f.isScalar).map((f) => f.name);
  const meaningfulScalars = fields.filter(
    (f) => f.isScalar && !f.isFk && !IGNORED_SCALARS.has(f.name),
  );
  const hasTenantHint =
    fields.some((f) => TENANT_HINT.test(f.name)) ||
    relations.some((r) => /^(Org|Organization|Tenant|Account|Workspace|Company)$/.test(r.target));

  // --- Heuristic classification (low confidence; for human ratification) ---
  let proposedClass: ModelInfo["proposedClass"];
  let confidence: ModelInfo["confidence"] = "low";
  let notes = "";

  const looksJoin = relations.length >= 2 && meaningfulScalars.length <= 1;
  const looksGlobal = GLOBAL_NAME_PATTERNS.some((re) => re.test(name));

  if (looksJoin) {
    proposedClass = "join";
    confidence = "medium";
    notes = `${relations.length} relations, ${meaningfulScalars.length} meaningful scalar(s) — likely a join/link table.`;
  } else if (looksGlobal) {
    proposedClass = "global";
    notes = "Name matches a platform/config pattern — verify it holds no per-tenant data.";
  } else {
    proposedClass = "tenant-scoped";
    notes = hasTenantHint
      ? "Already carries a tenant-ish FK."
      : "Default — domain data; needs a tenantId in multi-tenancy unless reachable only via a scoped parent.";
  }

  return {
    name,
    fieldCount: fields.length,
    relationCount: relations.length,
    meaningfulScalarCount: meaningfulScalars.length,
    scalarFields,
    relations,
    blockAttrs,
    hasTenantHint,
    proposedClass,
    confidence,
    reviewed: false,
    notes,
  };
}

function main() {
  const src = readFileSync(SCHEMA_PATH, "utf8");
  const scalarTypes = new Set([...PRISMA_SCALARS, ...collectEnums(src)]);

  const models: ModelInfo[] = [];
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    models.push(parseModel(m[1], m[2], scalarTypes));
  }
  models.sort((a, b) => a.name.localeCompare(b.name));

  const summary = models.reduce(
    (acc, mdl) => {
      acc[mdl.proposedClass]++;
      if (mdl.hasTenantHint) acc.alreadyTenantAware++;
      return acc;
    },
    { "tenant-scoped": 0, global: 0, join: 0, alreadyTenantAware: 0 } as Record<string, number>,
  );

  const out = {
    $schema: "model-map/v1",
    generatedAt: new Date().toISOString(),
    generator: "scripts/capture/model-map.ts",
    schemaPath: "apps/admin/prisma/schema.prisma",
    note: "Tier-2 generated KB. proposedClass is a HEURISTIC; ratify each row (set reviewed:true) to make this the authoritative tenant-scoping map. Do not hand-edit — re-run the generator.",
    modelCount: models.length,
    summary,
    models,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");

  console.log(`[model-map] ${models.length} models → ${OUT_PATH}`);
  console.log(
    `[model-map] proposed: ${summary["tenant-scoped"]} tenant-scoped · ${summary.global} global · ${summary.join} join · ${summary.alreadyTenantAware} already tenant-aware`,
  );
}

main();
