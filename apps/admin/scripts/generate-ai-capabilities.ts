#!/usr/bin/env tsx
/**
 * Generate docs/AI-CAPABILITIES.md from the canonical Cmd+K tool
 * registry in lib/chat/admin-tools.ts.
 *
 * Rationale (#852 → #859 → #862 thread):
 *   - lib/chat/admin-tools.ts is the registry the AI reads at every chat
 *     turn. It is the SPoT for capabilities.
 *   - Humans want a readable index of "what can the AI do?" without
 *     grepping code.
 *   - Auto-deriving the doc removes drift risk and keeps the registry
 *     as the source of truth.
 *
 * Usage:
 *   npx tsx scripts/generate-ai-capabilities.ts           # rewrite the doc
 *   npx tsx scripts/generate-ai-capabilities.ts --check   # exit 1 if stale (CI)
 *   npx tsx scripts/generate-ai-capabilities.ts --json    # machine output
 *
 * Sibling of doc-health.ts / check-doc-citations.ts / check-knowledge-map.ts.
 */

import * as fs from "fs";
import * as path from "path";

import { ADMIN_TOOLS } from "../lib/chat/admin-tools";

const ROOT = path.resolve(__dirname, "../../..");
const DOC_PATH = path.resolve(ROOT, "docs/AI-CAPABILITIES.md");
const HANDLERS_PATH = path.resolve(ROOT, "apps/admin/lib/chat/admin-tool-handlers.ts");

function loadToolMinRoleMap(): Record<string, string> {
  const src = fs.readFileSync(HANDLERS_PATH, "utf-8");
  const start = src.indexOf("const TOOL_MIN_ROLE");
  if (start === -1) throw new Error("Could not find TOOL_MIN_ROLE in admin-tool-handlers.ts");
  const openBrace = src.indexOf("{", start);
  const closeBrace = src.indexOf("};", openBrace);
  const body = src.slice(openBrace + 1, closeBrace);
  const map: Record<string, string> = {};
  for (const m of body.matchAll(/(\w+):\s*"(\w+)"/g)) map[m[1]] = m[2];
  return map;
}

function loadNotYetAvailableSet(): Set<string> {
  const src = fs.readFileSync(HANDLERS_PATH, "utf-8");
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
  tool: (typeof ADMIN_TOOLS)[number],
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
    minRole: roleMap[tool.name] ?? "(unset)",
    summary,
    requiredParams: allParams.filter((p) => required.has(p)),
    optionalParams: allParams.filter((p) => !required.has(p)),
  };
}

function renderMarkdown(rows: ToolRow[]): string {
  const live = rows.filter((r) => r.status === "live");
  const stubs = rows.filter((r) => r.status === "not-yet-available");
  const now = new Date().toISOString();
  const parts: string[] = [];
  parts.push("# Cmd+K AI Capabilities");
  parts.push("");
  parts.push(
    "**Auto-generated** from `apps/admin/lib/chat/admin-tools.ts` + the `TOOL_MIN_ROLE` map in `admin-tool-handlers.ts`. Do not edit by hand — run `npm run docs:ai-capabilities` to refresh, or `npm run docs:ai-capabilities:check` in CI to gate drift.",
  );
  parts.push("");
  parts.push(
    'Mirrors what the AI sees at every chat turn. "Live" tools execute real handlers. "Roadmap stubs" return a friendly refusal that tells the educator which UI to use today (the schema description carries the verbatim line the AI will say).',
  );
  parts.push("");
  parts.push(`> Last generated: ${now}`);
  parts.push(`> Live tools: ${live.length}`);
  parts.push(`> Roadmap stubs: ${stubs.length}`);
  parts.push("");
  parts.push("## Contract");
  parts.push("");
  parts.push(
    "Every educator-facing write must bump compose timestamps (per `docs/CHAIN-CONTRACTS.md` §3 Link 3 sub-contract). Every promised tool must be declared in `ADMIN_TOOLS[]` — the AI cannot invent capabilities. The dispatch in `admin-tool-handlers.ts` enforces RBAC via `TOOL_MIN_ROLE` *before* the handler runs, so STUDENT/VIEWER hit auth refusal before any read or write.",
  );
  parts.push("");

  function renderSection(title: string, ofRows: ToolRow[]) {
    parts.push(`## ${title}`);
    parts.push("");
    if (ofRows.length === 0) {
      parts.push("_(none)_");
      parts.push("");
      return;
    }
    parts.push("| Tool | Min role | Required | Optional | Summary |");
    parts.push("|------|----------|----------|----------|---------|");
    for (const r of ofRows) {
      const req = r.requiredParams.length ? "`" + r.requiredParams.join("`, `") + "`" : "—";
      const opt = r.optionalParams.length ? "`" + r.optionalParams.join("`, `") + "`" : "—";
      const summary = r.summary.replace(/\|/g, "\\|").replace(/\n/g, " ");
      parts.push(`| \`${r.name}\` | ${r.minRole} | ${req} | ${opt} | ${summary} |`);
    }
    parts.push("");
  }

  renderSection("Live tools", live);
  renderSection("Roadmap stubs (NOT YET AVAILABLE)", stubs);

  parts.push("## Promoting a stub");
  parts.push("");
  parts.push("1. Implement the handler in `apps/admin/lib/chat/admin-tool-handlers.ts`.");
  parts.push("2. Verify the RBAC entry (already at OPERATOR by default; bump if the op is destructive).");
  parts.push(
    "3. Remove the tool name from the `NOT_YET_AVAILABLE_TOOLS` Set and add a dispatch case routing to the real handler.",
  );
  parts.push("4. Strip the `NOT YET AVAILABLE — ` prefix from the description in `admin-tools.ts`.");
  parts.push("5. Run `npm run docs:ai-capabilities` to regenerate this file.");
  parts.push("");

  return parts.join("\n") + "\n";
}

function main() {
  const args = new Set(process.argv.slice(2));
  const check = args.has("--check");
  const asJson = args.has("--json");
  const roleMap = loadToolMinRoleMap();
  const notYet = loadNotYetAvailableSet();
  const rows = ADMIN_TOOLS.map((t) => buildRow(t, roleMap, notYet));
  rows.sort((a, b) => a.name.localeCompare(b.name));

  if (asJson) {
    process.stdout.write(JSON.stringify({ rows }, null, 2) + "\n");
    return;
  }

  const md = renderMarkdown(rows);

  if (check) {
    const existing = fs.existsSync(DOC_PATH) ? fs.readFileSync(DOC_PATH, "utf-8") : "";
    const stripStamp = (s: string) =>
      s.replace(/^> Last generated: .*$/m, "> Last generated: (omitted)");
    if (stripStamp(existing) === stripStamp(md)) {
      console.log(`[ai-capabilities:check] OK — ${rows.length} tools, ${notYet.size} stubs.`);
      return;
    }
    console.error(
      `[ai-capabilities:check] STALE — docs/AI-CAPABILITIES.md does not match the registry.\nRun: npm run docs:ai-capabilities`,
    );
    process.exit(1);
  }

  fs.writeFileSync(DOC_PATH, md);
  console.log(`[ai-capabilities] Wrote ${DOC_PATH} — ${rows.length} tools (${notYet.size} stubs).`);
}

main();
