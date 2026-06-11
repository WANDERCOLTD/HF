/**
 * Pins the operator-surfaces.json generator output shape and the
 * @operator-surface JSDoc tag detection contract.
 *
 * Three classes of test:
 *   1. End-to-end against the committed JSON — schema shape, ≥20 surfaces,
 *      sorted-by-route invariant.
 *   2. Unit-style: re-run the regex against synthetic strings to pin the
 *      tag-detection convention (must be `@operator-surface yes` exactly).
 *   3. Negative: a route without the tag is omitted from the live output.
 */

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, it, expect } from "vitest";

const OUT_PATH = resolve(
  __dirname,
  "../../../../docs/kb/generated/operator-surfaces.json",
);

type SurfaceCategory =
  | "courses"
  | "callers"
  | "voice"
  | "playbooks"
  | "settings"
  | "other";

interface OperatorSurface {
  route: string;
  file: string;
  methods: string[];
  authLevels: string[];
  description: string;
  category: SurfaceCategory;
}

interface SurfacesManifest {
  $schema: string;
  generatedAt: string;
  generator: string;
  note: string;
  surfaces: OperatorSurface[];
}

function readManifest(): SurfacesManifest {
  expect(
    existsSync(OUT_PATH),
    `${OUT_PATH} missing — run \`npm run kb:operator-surfaces\``,
  ).toBe(true);
  return JSON.parse(readFileSync(OUT_PATH, "utf8")) as SurfacesManifest;
}

describe("operator-surfaces.json generator output", () => {
  it("top-level shape matches the operator-surfaces/v1 schema", () => {
    const m = readManifest();
    expect(m.$schema).toBe("operator-surfaces/v1");
    expect(new Date(m.generatedAt).toString()).not.toBe("Invalid Date");
    expect(m.generator).toContain("operator-surfaces.ts");
    expect(Array.isArray(m.surfaces)).toBe(true);
  });

  it("at least 20 routes are annotated (story AC floor)", () => {
    const m = readManifest();
    expect(m.surfaces.length).toBeGreaterThanOrEqual(20);
  });

  it("every surface row carries the full shape (no missing fields)", () => {
    const m = readManifest();
    for (const s of m.surfaces) {
      expect(typeof s.route).toBe("string");
      expect(s.route.startsWith("/api/")).toBe(true);
      expect(typeof s.file).toBe("string");
      expect(s.file.endsWith("/route.ts")).toBe(true);
      expect(Array.isArray(s.methods)).toBe(true);
      expect(s.methods.length).toBeGreaterThan(0);
      expect(Array.isArray(s.authLevels)).toBe(true);
      expect(typeof s.description).toBe("string");
      expect([
        "courses",
        "callers",
        "voice",
        "playbooks",
        "settings",
        "other",
      ]).toContain(s.category);
    }
  });

  it("surfaces are sorted by route path", () => {
    const m = readManifest();
    const routes = m.surfaces.map((s) => s.route);
    const sorted = [...routes].sort((a, b) => a.localeCompare(b));
    expect(routes).toEqual(sorted);
  });

  it("the seed-list anchors are present (regression bait)", () => {
    const m = readManifest();
    const routes = new Set(m.surfaces.map((s) => s.route));
    expect(routes.has("/api/courses/[courseId]/regenerate-curriculum")).toBe(
      true,
    );
    expect(routes.has("/api/voice-providers/[id]/sample")).toBe(true);
    expect(routes.has("/api/callers/[callerId]/cascade/voice")).toBe(true);
  });
});

describe("@operator-surface tag detection invariants", () => {
  // The generator uses this exact regex. The tests document the convention
  // and lock the spelling — operators reading the JSDoc need a single
  // authoritative form.
  const TAG_RE = /@operator-surface\s+yes\b/;

  it("matches the canonical spelling", () => {
    expect(TAG_RE.test("* @operator-surface yes")).toBe(true);
    expect(TAG_RE.test(" *  @operator-surface  yes")).toBe(true);
    expect(TAG_RE.test("@operator-surface yes\n")).toBe(true);
  });

  it("rejects close variants (operators must use the exact form)", () => {
    expect(TAG_RE.test("@operatorSurface yes")).toBe(false);
    expect(TAG_RE.test("@operator-surface: yes")).toBe(false);
    expect(TAG_RE.test("@operator-surface no")).toBe(false);
    expect(TAG_RE.test("@operator-surface")).toBe(false);
    // No standalone-token word boundary: "yesterday" must NOT match
    expect(TAG_RE.test("@operator-surface yesterday")).toBe(false);
  });
});

/**
 * Parses a synthetic route.ts string the same way the generator does.
 * Mirrors the regex shapes in `scripts/capture/operator-surfaces.ts` so we
 * can pin the per-route parse without spinning up the full file walker.
 */
function parseRouteSource(src: string): {
  tagged: boolean;
  methods: string[];
  authLevels: string[];
  description: string;
} {
  const tagged = /@operator-surface\s+yes\b/.test(src);
  const HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
  const methods = HTTP.filter(
    (m) =>
      new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(src) ||
      new RegExp(`export\\s+const\\s+${m}\\b`).test(src),
  );
  const authLevels = [
    ...new Set(
      [...src.matchAll(/requireAuth\(\s*["'`](\w+)["'`]/g)].map((m) => m[1]),
    ),
  ];
  const descMatch = /@description\s+([^\n*][^\n]*)/.exec(src);
  const apiMatch = /@api\s+(?:GET|POST|PUT|PATCH|DELETE)\s+(.+?)\s*$/m.exec(src);
  const description = descMatch
    ? descMatch[1].trim()
    : apiMatch
      ? apiMatch[1].trim()
      : "";
  return { tagged, methods, authLevels, description };
}

describe("generator per-route parsing (unit-level)", () => {
  it("parses a route with @operator-surface yes + @description into a surface entry", () => {
    const src = `
      /**
       * @operator-surface yes
       *
       * @api POST /api/courses/:courseId/regenerate-curriculum
       * @description Regenerate the curriculum for a course
       */
      export async function POST() {
        const auth = await requireAuth("OPERATOR");
      }
    `;
    const parsed = parseRouteSource(src);
    expect(parsed.tagged).toBe(true);
    expect(parsed.methods).toEqual(["POST"]);
    expect(parsed.authLevels).toEqual(["OPERATOR"]);
    expect(parsed.description).toBe("Regenerate the curriculum for a course");
  });

  it("omits a route without the @operator-surface tag (zero false positives)", () => {
    const src = `
      /**
       * @api GET /api/foo
       * @description This route is NOT tagged
       */
      export async function GET() {
        const auth = await requireAuth("VIEWER");
      }
    `;
    const parsed = parseRouteSource(src);
    expect(parsed.tagged).toBe(false);
  });

  it("falls back to @api summary when @description is absent", () => {
    const src = `
      /**
       * @operator-surface yes
       *
       * @api GET /api/voice/[slug]/catalog
       */
      export const GET = async () => {
        const auth = await requireAuth("OPERATOR");
      };
    `;
    const parsed = parseRouteSource(src);
    expect(parsed.tagged).toBe(true);
    expect(parsed.methods).toEqual(["GET"]);
    // @api summary is the fallback (route summary line)
    expect(parsed.description).toContain("/api/voice/[slug]/catalog");
  });
});

describe("end-to-end: generator omits unannotated routes (negative pin)", () => {
  it("a known untagged route is not present in the output", () => {
    // /api/health is a high-traffic public route never tagged as
    // operator-surface — it should NEVER appear in the output even though
    // its file exists in app/api/health/route.ts.
    const m = readManifest();
    const routes = new Set(m.surfaces.map((s) => s.route));
    expect(routes.has("/api/health")).toBe(false);
    expect(routes.has("/api/ready")).toBe(false);
  });
});

describe("integration with the walker (mini fixture)", () => {
  it("a fresh temp directory tree only emits surfaces whose route.ts carries the tag", () => {
    // Mirror the walker's algorithm against a tiny temp tree to prove the
    // inclusion gate is the tag, not the file's existence.
    const dir = mkdtempSync(join(tmpdir(), "op-surfaces-test-"));
    const tagged = join(dir, "tagged");
    const plain = join(dir, "plain");
    mkdirSync(tagged, { recursive: true });
    mkdirSync(plain, { recursive: true });
    writeFileSync(
      join(tagged, "route.ts"),
      "/** @operator-surface yes */\nexport async function GET(){}",
    );
    writeFileSync(
      join(plain, "route.ts"),
      "/** not tagged */\nexport async function GET(){}",
    );

    const found: string[] = [];
    const TAG = /@operator-surface\s+yes\b/;
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        const full = join(d, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name === "route.ts" && TAG.test(readFileSync(full, "utf8")))
          found.push(full);
      }
    };
    walk(dir);
    expect(found.length).toBe(1);
    expect(found[0]).toContain("/tagged/");
  });
});
