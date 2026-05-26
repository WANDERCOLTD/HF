#!/usr/bin/env tsx
/**
 * Generate docs/AI-CAPABILITIES.md from every Cmd+K / Wizard / Course-Ref
 * tool registry in lib/chat/.
 *
 * Rationale (#852 → #859 → #862 → #866 thread):
 *   - The three registry files in lib/chat/ are the Single Point of Truth
 *     for "what can the AI do?" — the AI reads them directly at every
 *     chat turn.
 *   - Humans want a single readable index without grepping code.
 *   - Auto-deriving removes drift risk and keeps code as the SoT.
 *
 * The contract this script enforces (see docs/CHAIN-CONTRACTS.md §3 Link 3):
 *   - Every AI write path lives in one of the three registries below.
 *   - Every entry must declare RBAC via TOOL_MIN_ROLE in its handler module.
 *   - Every NOT YET AVAILABLE tool must be marked with that prefix in
 *     its description AND listed in the relevant NOT_YET_AVAILABLE_* Set.
 *   - The generated doc cannot disagree with the registries — CI gates
 *     drift via `docs:ai-capabilities:check`.
 *
 * Usage:
 *   npx tsx scripts/generate-ai-capabilities.ts           # rewrite the doc
 *   npx tsx scripts/generate-ai-capabilities.ts --check   # exit 1 if stale (CI)
 *   npx tsx scripts/generate-ai-capabilities.ts --json    # machine output
 */

import * as fs from "fs";
import * as path from "path";

import { ADMIN_TOOLS } from "../lib/chat/admin-tools";
import { CONVERSATIONAL_TOOLS } from "../lib/chat/conversational-wizard-tools";
import { COURSE_REF_TOOLS } from "../lib/chat/course-ref-tools";

const ROOT = path.resolve(__dirname, "../../..");
const DOC_PATH = path.resolve(ROOT, "docs/AI-CAPABILITIES.md");
const ADMIN_HANDLERS_PATH = path.resolve(ROOT, "apps/admin/lib/chat/admin-tool-handlers.ts");

interface RegistrySpec {
  /** Display name in the doc. */
  surface: string;
  /** Path to the schema file (just for the "Source" header in the doc). */
  schemaFile: string;
  /** Tools defined in the schema file. */
  tools: { name: string; description: string; input_schema?: unknown }[];
  /** Path to the handler file we parse for RBAC + NOT_YET_AVAILABLE markers. */
  handlerFile: string;
}

const REGISTRIES: RegistrySpec[] = [
  {
    surface: "Cmd+K (admin chat)",
    schemaFile: "apps/admin/lib/chat/admin-tools.ts",
    tools: ADMIN_TOOLS,
    handlerFile: ADMIN_HANDLERS_PATH,
  },
  {
    surface: "Wizard (course-creation chat)",
    schemaFile: "apps/admin/lib/chat/conversational-wizard-tools.ts",
    tools: CONVERSATIONAL_TOOLS,
    // Wizard tools dispatch through wizard-tool-executor.ts; no
    // TOOL_MIN_ROLE table there today (RBAC handled upstream by the
    // /api/wizard/chat route which already calls requireAuth). So role
    // parsing returns an empty map and the doc shows "(route-level)".
    handlerFile: path.resolve(ROOT, "apps/admin/lib/chat/wizard-tool-executor.ts"),
  },
  {
    surface: "Course-Ref (course-reference chat)",
    schemaFile: "apps/admin/lib/chat/course-ref-tools.ts",
    tools: COURSE_REF_TOOLS,
    handlerFile: path.resolve(ROOT, "apps/admin/lib/chat/course-ref-tool-handlers.ts"),
  },
];

function loadToolMinRoleMap(handlerPath: string): Record<string, string> {
  if (!fs.existsSync(handlerPath)) return {};
  const src = fs.readFileSync(handlerPath, "utf-8");
  const start = src.indexOf("const TOOL_MIN_ROLE");
  if (start === -1) return {};
  const openBrace = src.indexOf("{", start);
  const closeBrace = src.indexOf("};", openBrace);
  if (openBrace === -1 || closeBrace === -1) return {};
  const body = src.slice(openBrace + 1, closeBrace);
  const map: Record<string, string> = {};
  for (const m of body.matchAll(/(\w+):\s*"(\w+)"/g)) map[m[1]] = m[2];
  return map;
}

function loadNotYetAvailableSet(handlerPath: string): Set<string> {
  if (!fs.existsSync(handlerPath)) return new Set();
  const src = fs.readFileSync(handlerPath, "utf-8");
  const start = src.indexOf("NOT_YET_AVAILABLE_TOOLS");
  if (start === -1) return new Set();
  const openBracket = src.indexOf("[", start);
  const closeBracket = src.indexOf("]", openBracket);
  if (openBracket === -1 || closeBracket === -1) return new Set();
  const body = src.slice(openBracket + 1, closeBracket);
  const out = new Set<string>();
  for (const m of body.matchAll(/"(\w+)"/g)) out.add(m[1]);
  return out;
}

interface ToolRow {
  name: string;
  status: "live" | "not-yet-available";
  minRole: string;
  summary: string;
  requiredParams: string[];
  optionalParams: string[];
}

function buildRow(
  tool: { name: string; description: string; input_schema?: unknown },
  roleMap: Record<string, string>,
  notYet: Set<string>,
): ToolRow {
  const isStub = notYet.has(tool.name) || /^NOT YET AVAILABLE/.test(tool.description);
  const cleanedDesc = tool.description.replace(/^NOT YET AVAILABLE\s*[—–-]\s*/, "");
  const summaryMatch = cleanedDesc.match(/^[^.]+\./);
  const summary = (summaryMatch ? summaryMatch[0] : cleanedDesc).trim();
  const schema = (tool.input_schema ?? {}) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  const allParams = Object.keys(schema.properties ?? {});
  const required = new Set(schema.required ?? []);
  return {
    name: tool.name,
    status: isStub ? "not-yet-available" : "live",
    minRole: roleMap[tool.name] ?? "(route-level)",
    summary,
    requiredParams: allParams.filter((p) => required.has(p)),
    optionalParams: allParams.filter((p) => !required.has(p)),
  };
}

interface RegistryRender {
  surface: string;
  schemaFile: string;
  live: ToolRow[];
  stubs: ToolRow[];
}

function renderRegistry(spec: RegistrySpec): RegistryRender {
  const roleMap = loadToolMinRoleMap(spec.handlerFile);
  const notYet = loadNotYetAvailableSet(spec.handlerFile);
  const rows = spec.tools
    .map((t) => buildRow(t, roleMap, notYet))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    surface: spec.surface,
    schemaFile: spec.schemaFile,
    live: rows.filter((r) => r.status === "live"),
    stubs: rows.filter((r) => r.status === "not-yet-available"),
  };
}

function renderMarkdown(renders: RegistryRender[]): string {
  const totalLive = renders.reduce((s, r) => s + r.live.length, 0);
  const totalStubs = renders.reduce((s, r) => s + r.stubs.length, 0);
  const totalTools = totalLive + totalStubs;
  const now = new Date().toISOString();
  const parts: string[] = [];
  parts.push("# AI Capabilities");
  parts.push("");
  parts.push(
    "**Auto-generated** from the three AI tool registries in `apps/admin/lib/chat/` + the `TOOL_MIN_ROLE` map in each registry's handler. Do not edit by hand — run `npm run docs:ai-capabilities` to refresh, or `npm run docs:ai-capabilities:check` in CI to gate drift.",
  );
  parts.push("");
  parts.push(
    'This mirrors what the AI sees at every chat turn across all three AI surfaces. "Live" tools execute real handlers. "Roadmap stubs" return a friendly refusal that points the user at the UI surface to use today.',
  );
  parts.push("");
  parts.push(`> Last generated: ${now}`);
  parts.push(`> Surfaces: ${renders.length}`);
  parts.push(`> Total tools: ${totalTools} (${totalLive} live, ${totalStubs} roadmap stubs)`);
  parts.push("");

  parts.push("## Contract");
  parts.push("");
  parts.push(
    "Per `docs/CHAIN-CONTRACTS.md` §3 Link 3:",
  );
  parts.push("");
  parts.push("1. Every AI write path must be declared in one of the registries below.");
  parts.push("2. Every entry must declare RBAC via `TOOL_MIN_ROLE` in its handler module.");
  parts.push("3. Every NOT YET AVAILABLE tool must carry the prefix in its description AND be listed in `NOT_YET_AVAILABLE_TOOLS`.");
  parts.push("4. Every compose-affecting write must route through a `update*Config` helper or call `bump*ComposeTimestamp` — never write `prisma.{playbook,domain,analysisSpec}.update` directly. ESLint rules enforce this at severity `error`.");
  parts.push("5. This file is auto-derived. CI fails on drift.");
  parts.push("");

  function renderTable(title: string, rows: ToolRow[]) {
    parts.push(`### ${title}`);
    parts.push("");
    if (rows.length === 0) {
      parts.push("_(none)_");
      parts.push("");
      return;
    }
    parts.push("| Tool | Min role | Required | Optional | Summary |");
    parts.push("|------|----------|----------|----------|---------|");
    for (const r of rows) {
      const req = r.requiredParams.length ? "`" + r.requiredParams.join("`, `") + "`" : "—";
      const opt = r.optionalParams.length ? "`" + r.optionalParams.join("`, `") + "`" : "—";
      const summary = r.summary.replace(/\|/g, "\\|").replace(/\n/g, " ");
      parts.push(`| \`${r.name}\` | ${r.minRole} | ${req} | ${opt} | ${summary} |`);
    }
    parts.push("");
  }

  for (const r of renders) {
    parts.push(`## ${r.surface}`);
    parts.push("");
    parts.push(`Source: \`${r.schemaFile}\``);
    parts.push("");
    parts.push(`${r.live.length} live, ${r.stubs.length} stubs.`);
    parts.push("");
    renderTable("Live tools", r.live);
    if (r.stubs.length > 0) renderTable("Roadmap stubs (NOT YET AVAILABLE)", r.stubs);
  }

  parts.push("## Promoting a stub");
  parts.push("");
  parts.push("1. Implement the handler in the registry's handler module.");
  parts.push("2. Verify the RBAC entry in `TOOL_MIN_ROLE` (default OPERATOR; bump if destructive).");
  parts.push("3. Remove the tool name from the `NOT_YET_AVAILABLE_TOOLS` Set and add a dispatch case routing to the real handler.");
  parts.push("4. Strip the `NOT YET AVAILABLE — ` prefix from the description in the registry.");
  parts.push("5. Run `npm run docs:ai-capabilities` to regenerate this file.");
  parts.push("");

  return parts.join("\n") + "\n";
}

function main() {
  const args = new Set(process.argv.slice(2));
  const check = args.has("--check");
  const asJson = args.has("--json");
  const renders = REGISTRIES.map(renderRegistry);

  if (asJson) {
    process.stdout.write(JSON.stringify({ renders }, null, 2) + "\n");
    return;
  }

  const md = renderMarkdown(renders);
  const totalTools = renders.reduce((s, r) => s + r.live.length + r.stubs.length, 0);
  const totalStubs = renders.reduce((s, r) => s + r.stubs.length, 0);

  if (check) {
    const existing = fs.existsSync(DOC_PATH) ? fs.readFileSync(DOC_PATH, "utf-8") : "";
    const stripStamp = (s: string) =>
      s.replace(/^> Last generated: .*$/m, "> Last generated: (omitted)");
    if (stripStamp(existing) === stripStamp(md)) {
      console.log(
        `[ai-capabilities:check] OK — ${renders.length} surfaces, ${totalTools} tools, ${totalStubs} stubs.`,
      );
      return;
    }
    console.error(
      `[ai-capabilities:check] STALE — docs/AI-CAPABILITIES.md does not match the registries.\nRun: npm run docs:ai-capabilities`,
    );
    process.exit(1);
  }

  fs.writeFileSync(DOC_PATH, md);
  console.log(
    `[ai-capabilities] Wrote ${DOC_PATH} — ${renders.length} surfaces, ${totalTools} tools (${totalStubs} stubs).`,
  );
}

main();
