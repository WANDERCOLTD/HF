/**
 * Contract Test: API JSDoc @response ↔ NextResponse.json parity (#424).
 *
 * Pure static analysis — no HTTP, no DB, no server. Runs in the unit suite.
 *
 * Background:
 *
 * #418 shipped a "curriculum chip + Authored/Derived toggle" feature whose
 * client-side hook (`useCourseSetupStatus`) read `activeCurriculumMode` from
 * `/api/courses/[courseId]/setup-status`. The route's JSDoc declared a field
 * (`details`) it never returned, and a later iteration added the
 * `activeCurriculumMode` field to both JSDoc and return — but a prior
 * (since-fixed) regression had the field declared without being wired into
 * `NextResponse.json({...})`. No test caught the drift; the chip silently
 * never rendered for users.
 *
 * This test walks every `apps/admin/app/api/**\/route.ts`, parses each
 * exported HTTP method's `@api @response 200 {...}` JSDoc shape, parses every
 * `NextResponse.json({...})` literal in the route, and fails if any documented
 * field is missing from at least one success-path return statement.
 *
 * Out of scope (v1):
 * - Streaming responses (SSE, NextResponse.body) — declared via `@response 200 text/...`
 * - Nested object shapes — top-level field names is enough
 * - Type-name parity — `useCourseSetupStatus` would have been caught by name alone
 * - Client-consumer parity (which hooks read which fields) — see #424 stretch
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "tinyglobby";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../..");
const API_GLOB = "app/api/**/route.ts";

/**
 * Pre-existing drift cases the test surfaces on first run. Each entry is
 * `{routeFile}::{METHOD}::{field}` — a single drift to ignore. NEW drift is
 * still caught (any field not in this list triggers the failure).
 *
 * Cleanup tracked separately — these are aspirational JSDoc fields that were
 * never wired into the return statement OR fields the implementation added
 * without updating the JSDoc. None are causing live UI breaks today (#418's
 * activeCurriculumMode-style break was already fixed before this test
 * landed). Convert this to an empty array as routes are cleaned up.
 */
const KNOWN_DRIFT: ReadonlySet<string> = new Set([
  // Empty after sweep — any drift found here should be fixed by editing
  // the route's JSDoc to match the actual NextResponse.json shape, OR by
  // adding the missing field to the return statement. Add an entry here
  // only as a temporary suppression while you raise a follow-up issue.
]);

interface RouteContractIssue {
  routeFile: string;
  method: string;
  documented: string[];
  returned: string[];
  missingFromReturn: string[];
}

/**
 * Extract the `@response 200 {...}` field list from a JSDoc block.
 * Returns the list of top-level field names, or null if no `@response 200` is
 * found, or "streaming" if the response is a streaming content-type.
 */
function parseResponseFields(jsdoc: string): string[] | "streaming" | null {
  const match = jsdoc.match(/@response\s+200\s+([^\n@]+)/);
  if (!match) return null;
  const body = match[1].trim();

  if (/^text\/|^application\/(octet-stream|pdf)|stream/i.test(body)) {
    return "streaming";
  }

  // Bare type-name response (e.g. `@response 200 Parameter (with ...)`) —
  // the route returns a flat record, not a wrapped object. Skip parity check.
  if (!body.startsWith("{")) {
    return "streaming";
  }

  const inner = body.replace(/^\{\s*/, "").replace(/\s*\}\s*$/, "");
  if (!inner) return [];

  const fields: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of inner) {
    if (ch === "{" || ch === "[" || ch === "(" || ch === "<") depth++;
    else if (ch === "}" || ch === "]" || ch === ")" || ch === ">") depth--;
    if (ch === "," && depth === 0) {
      fields.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) fields.push(buf.trim());

  return fields
    .map((f) => {
      const idMatch = f.match(/^([a-zA-Z_$][\w$]*)/);
      return idMatch ? idMatch[1] : "";
    })
    .filter((f) => f.length > 0);
}

/**
 * Extract the set of top-level keys returned by every NextResponse.json({...})
 * call in the route source. Ignores keys inside nested objects/arrays. Skips
 * error-path returns (status: 4xx | 5xx) — the @response 200 contract is the
 * success path only.
 */
/**
 * Returned-fields parser. Returns `"spread"` if any success-path return uses
 * `...spread` syntax — the spread can pull in arbitrary fields at runtime,
 * so we can't statically prove parity. Caller should skip such routes.
 */
function parseReturnedFields(source: string): string[] | "spread" {
  const keys = new Set<string>();
  const re = /NextResponse\.json\s*\(\s*\{/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const start = m.index + m[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = start; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    const objLiteral = source.slice(start + 1, end);

    const tail = source.slice(end + 1, Math.min(end + 200, source.length));
    if (/^\s*,\s*\{\s*[^}]*status\s*:\s*[45]\d\d/.test(tail)) continue;

    let depth2 = 0;
    let buf = "";
    const top: string[] = [];
    for (const ch of objLiteral) {
      if (ch === "{" || ch === "[" || ch === "(") depth2++;
      else if (ch === "}" || ch === "]" || ch === ")") depth2--;
      if (ch === "," && depth2 === 0) {
        top.push(buf);
        buf = "";
      } else {
        buf += ch;
      }
    }
    if (buf.trim()) top.push(buf);

    for (const entry of top) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("...")) {
        // Spread can pull in arbitrary fields at runtime — abort static check.
        return "spread";
      }
      const idMatch = trimmed.match(/^([a-zA-Z_$][\w$]*)/);
      if (idMatch) keys.add(idMatch[1]);
    }
  }
  return [...keys];
}

/** JSDoc block immediately preceding `export async function METHOD`. */
function extractJsdocForExport(source: string, method: string): string | null {
  const re = new RegExp(
    `/\\*\\*([\\s\\S]*?)\\*/\\s*export\\s+async\\s+function\\s+${method}\\b`,
  );
  const m = source.match(re);
  return m ? m[1] : null;
}

describe("API contract: @response 200 JSDoc parity with NextResponse.json (#424)", () => {
  it("every documented @response 200 field appears in at least one NextResponse.json({...}) call", () => {
    const routeFiles = globSync([API_GLOB], { cwd: REPO_ROOT, absolute: true });
    expect(routeFiles.length).toBeGreaterThan(0);

    const issues: RouteContractIssue[] = [];

    for (const file of routeFiles) {
      const source = readFileSync(file, "utf8");
      const relPath = path.relative(REPO_ROOT, file);

      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const jsdoc = extractJsdocForExport(source, method);
        if (!jsdoc) continue;

        const documented = parseResponseFields(jsdoc);
        if (!documented || documented === "streaming") continue;

        const returned = parseReturnedFields(source);
        if (returned === "spread") continue; // can't statically verify
        if (returned.length === 0) continue;

        const missingFromReturn = documented.filter(
          (f) => !returned.includes(f) && !KNOWN_DRIFT.has(`${relPath}::${method}::${f}`),
        );
        if (missingFromReturn.length > 0) {
          issues.push({ routeFile: relPath, method, documented, returned, missingFromReturn });
        }
      }
    }

    if (issues.length > 0) {
      const report = issues
        .map(
          (i) =>
            `  ${i.method} ${i.routeFile}\n` +
            `     documented: [${i.documented.join(", ")}]\n` +
            `     returned:   [${i.returned.join(", ")}]\n` +
            `     missing:    [${i.missingFromReturn.join(", ")}] — either add to NextResponse.json({...}) or remove from @response JSDoc`,
        )
        .join("\n\n");
      throw new Error(
        `Found ${issues.length} route(s) where @response 200 JSDoc declares fields not present in NextResponse.json({...}):\n\n${report}\n\n` +
          `See #424 — silent contract drift causes UI features to ship broken (e.g. #418 curriculum chip).`,
      );
    }
  });
});
