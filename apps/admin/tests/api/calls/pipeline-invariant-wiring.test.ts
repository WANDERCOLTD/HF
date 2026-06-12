/**
 * Pipeline end-of-run invariant-runner wiring — Slice 1 of epic #1510 (#1511).
 *
 * Defends:
 *   - `checkInvariantsAfterPipeline` is called from `runSpecDrivenPipeline`
 *     AFTER the COMPOSE + CallerIdentity update, NOT before
 *   - The call is fire-and-forget — never awaited, never blocks the response
 *   - A throw from the runner does NOT bubble out (errors are swallowed)
 *
 * Static-import sanity: route.ts imports the runner from
 * `@/lib/pipeline/adaptive-loop-invariants`. We assert the symbol is present
 * in the route's source so a future refactor can't silently drop the wiring.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROUTE_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "app",
  "api",
  "calls",
  "[callId]",
  "pipeline",
  "route.ts",
);

describe("pipeline route — invariant-runner wiring (#1511)", () => {
  let src: string;

  it("route.ts exists at the expected path", () => {
    expect(fs.existsSync(ROUTE_PATH)).toBe(true);
    src = fs.readFileSync(ROUTE_PATH, "utf8");
  });

  it("imports checkInvariantsAfterPipeline from @/lib/pipeline/adaptive-loop-invariants", () => {
    src ??= fs.readFileSync(ROUTE_PATH, "utf8");
    expect(src).toMatch(
      /from\s+["']@\/lib\/pipeline\/adaptive-loop-invariants["']/,
    );
    expect(src).toMatch(/checkInvariantsAfterPipeline/);
  });

  it("calls checkInvariantsAfterPipeline fire-and-forget (void + .catch chain)", () => {
    src ??= fs.readFileSync(ROUTE_PATH, "utf8");
    // We MUST NOT `await checkInvariantsAfterPipeline(...)` — the pipeline
    // response must not block on the observability runner. Pin the
    // fire-and-forget pattern syntactically.
    const callIdx = src.indexOf("checkInvariantsAfterPipeline(ctx.callId)");
    expect(callIdx).toBeGreaterThan(-1);

    // Examine the preceding ~80 chars — must be `void ` (no await).
    const preceding = src.slice(Math.max(0, callIdx - 80), callIdx);
    expect(preceding).toMatch(/void\s*$/);
    expect(preceding).not.toMatch(/await\s*$/);

    // Examine the trailing ~80 chars — must `.catch(...)` so a rejection
    // doesn't surface as an unhandled-promise warning.
    const trailing = src.slice(
      callIdx,
      Math.min(src.length, callIdx + 80),
    );
    expect(trailing).toMatch(/\.catch\(/);
  });

  it("call site appears AFTER the CallerIdentity update block", () => {
    src ??= fs.readFileSync(ROUTE_PATH, "utf8");
    const idxIdentity = src.indexOf("CallerIdentity update failed");
    const idxRunner = src.indexOf("checkInvariantsAfterPipeline(ctx.callId)");
    expect(idxIdentity).toBeGreaterThan(-1);
    expect(idxRunner).toBeGreaterThan(idxIdentity);
  });

  it("references the #1511 chain-contracts pointer in the call-site comment", () => {
    src ??= fs.readFileSync(ROUTE_PATH, "utf8");
    // The comment block at the call site explains WHY it's fire-and-forget.
    // Pinning the doc reference here keeps the next dev one search away.
    expect(src).toMatch(/CHAIN-CONTRACTS\.md\s*§6|epic #1510 Slice 1|#1511/);
  });
});
