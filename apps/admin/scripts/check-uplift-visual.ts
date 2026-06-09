// KB: catalogued in docs/kb/guard-registry.md (CI check scripts). See for class + why.
/**
 * Caller Insights — Visual Regression (standalone, no Playwright test runner)
 *
 * Captures full-page screenshots of all five caller-insight tabs and diffs
 * them against a tracked baseline. Lives outside the Playwright test harness
 * so it doesn't drag in the brittle login fixture — auth is minted via the
 * NextAuth credentials API and the session cookie is injected directly into
 * the headless Chromium context.
 *
 * Usage:
 *   npx tsx scripts/check-uplift-visual.ts            # diff vs baseline
 *   npx tsx scripts/check-uplift-visual.ts --update   # write/refresh baseline
 *   BASE_URL=http://localhost:3000 SEED_ADMIN_PASSWORD=… npx tsx …
 *
 * Exit codes:
 *   0  every tab within DIFF_THRESHOLD (or --update succeeded)
 *   1  one or more tabs exceeded the threshold; diff PNGs written
 *   2  setup failed (no server, no caller, auth refused)
 *
 * Outputs (under apps/admin/e2e-snapshots/uplift/):
 *   baseline/<tab>.png    tracked in git
 *   current/<tab>.png     written every run; gitignored
 *   diff/<tab>.diff.txt   per-tab failure summary; gitignored
 */

import { chromium, type BrowserContext } from "@playwright/test";
import { PNG } from "pngjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_DIR = path.join(ROOT, "e2e-snapshots", "uplift");
const BASELINE_DIR = path.join(SNAPSHOT_DIR, "baseline");
const CURRENT_DIR = path.join(SNAPSHOT_DIR, "current");
const DIFF_DIR = path.join(SNAPSHOT_DIR, "diff");

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@test.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
const UPDATE = process.argv.includes("--update");
const DIFF_THRESHOLD = 0.005; // 0.5% — survives anti-alias noise

/** Pin a specific caller via env or arg — bypasses /x/callers discovery. */
const CALLER_OVERRIDE =
  process.env.HF_CALLER_HREF ??
  process.env.HF_CALLER_ID ??
  process.argv.find((a) => a.startsWith("--caller="))?.slice("--caller=".length);

const TABS: Array<{ id: string; file: string }> = [
  { id: "overview", file: "overview.png" },
  { id: "overview-v2", file: "overview-v2.png" },
  { id: "uplift", file: "uplift-v1.png" },
  { id: "what", file: "progress-v1.png" },
  { id: "uplift-v2", file: "uplift-v2.png" },
  { id: "progress-v2", file: "progress-v2.png" },
];

const FREEZE_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
  }
`;

// ---------------------------------------------------------------------------
// Auth — mint a session cookie via the API. Bypasses the UI login entirely
// so changes to /login (chat widgets, extra submit buttons, …) never break us.
// ---------------------------------------------------------------------------

type Cookie = { name: string; value: string; domain: string; path: string };

function parseSetCookies(raw: string[], hostname: string): Cookie[] {
  return raw
    .map((line) => {
      const [pair] = line.split(";").map((s) => s.trim());
      const eq = pair.indexOf("=");
      if (eq < 0) return null;
      return {
        name: pair.slice(0, eq),
        value: pair.slice(eq + 1),
        domain: hostname,
        path: "/",
      };
    })
    .filter((c): c is Cookie => c !== null);
}

function dedupe(cookies: Cookie[]): Cookie[] {
  const map = new Map<string, Cookie>();
  for (const c of cookies) map.set(`${c.name}@${c.domain}`, c);
  return Array.from(map.values());
}

async function mintSession(): Promise<Cookie[]> {
  const url = new URL(BASE_URL);

  // 1. Fetch CSRF token + capture the csrf-token cookie
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`);
  if (!csrfRes.ok) {
    throw new Error(`CSRF fetch failed: ${csrfRes.status}`);
  }
  const csrfBody = (await csrfRes.json()) as { csrfToken?: string };
  if (!csrfBody.csrfToken) {
    throw new Error("CSRF token missing from /api/auth/csrf response");
  }
  const csrfSetCookies = csrfRes.headers.getSetCookie?.() ?? [];
  const csrfCookieHeader = csrfSetCookies
    .map((c) => c.split(";")[0])
    .join("; ");

  // 2. POST credentials with the csrf token + csrf cookie
  const form = new URLSearchParams({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    csrfToken: csrfBody.csrfToken,
    callbackUrl: `${BASE_URL}/`,
    json: "true",
  });
  const signinRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: csrfCookieHeader,
    },
    body: form.toString(),
  });
  if (signinRes.status >= 400) {
    throw new Error(
      `Sign-in refused: ${signinRes.status}. Check SEED_ADMIN_PASSWORD.`,
    );
  }
  const signinSetCookies = signinRes.headers.getSetCookie?.() ?? [];

  const all = dedupe([
    ...parseSetCookies(csrfSetCookies, url.hostname),
    ...parseSetCookies(signinSetCookies, url.hostname),
  ]);

  // Sanity: ensure we got a session token
  const hasSession = all.some((c) =>
    /session-token$/.test(c.name) || c.name.includes("session-token"),
  );
  if (!hasSession) {
    throw new Error(
      `No session-token cookie in sign-in response. Got: ${all.map((c) => c.name).join(", ")}`,
    );
  }
  return all;
}

// ---------------------------------------------------------------------------
// Pixel diff — pure pngjs, no extra dependency
// ---------------------------------------------------------------------------

function diffRatio(
  baseline: PNG,
  current: PNG,
): { ratio: number; bad: number; total: number; sizeMismatch: boolean } {
  if (
    baseline.width !== current.width ||
    baseline.height !== current.height
  ) {
    return {
      ratio: Infinity,
      bad: -1,
      total: baseline.width * baseline.height,
      sizeMismatch: true,
    };
  }
  const total = baseline.width * baseline.height;
  let bad = 0;
  for (let i = 0; i < baseline.data.length; i += 4) {
    const dr = Math.abs(baseline.data[i] - current.data[i]);
    const dg = Math.abs(baseline.data[i + 1] - current.data[i + 1]);
    const db = Math.abs(baseline.data[i + 2] - current.data[i + 2]);
    // Sum-of-channels tolerance — keeps anti-alias noise below the line
    if (dr + dg + db > 30) bad++;
  }
  return { ratio: bad / total, bad, total, sizeMismatch: false };
}

// ---------------------------------------------------------------------------
// Capture flow
// ---------------------------------------------------------------------------

async function pickFirstCallerHref(
  ctx: BrowserContext,
): Promise<string | null> {
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE_URL}/x/callers`, { waitUntil: "networkidle" });
    const link = page.locator('a[href*="/x/callers/"]').first();
    if (!(await link.isVisible({ timeout: 8_000 }).catch(() => false))) {
      return null;
    }
    return await link.getAttribute("href");
  } finally {
    await page.close();
  }
}

async function captureTab(
  ctx: BrowserContext,
  href: string,
  tabId: string,
): Promise<Buffer> {
  const page = await ctx.newPage();
  // Cold dev-server compiles can take 30-60s on the first hit per page,
  // so the per-page navigation budget needs to be generous.
  page.setDefaultNavigationTimeout(90_000);
  page.setDefaultTimeout(30_000);
  try {
    // domcontentloaded is enough for screenshot purposes — networkidle gets
    // wedged by Next.js dev-server long-poll connections in some routes.
    await page.goto(`${BASE_URL}${href}?tab=${tabId}`, {
      waitUntil: "domcontentloaded",
    });
    // Let the client mount + the registry-driven sections issue their data
    // fetches, then settle for a paint frame.
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    await page.addStyleTag({ content: FREEZE_CSS });
    await page.waitForTimeout(500);
    return await page.screenshot({ fullPage: true, type: "png" });
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  mkdirSync(BASELINE_DIR, { recursive: true });
  mkdirSync(CURRENT_DIR, { recursive: true });
  mkdirSync(DIFF_DIR, { recursive: true });

  console.log(`[check-uplift] base=${BASE_URL}  update=${UPDATE}`);

  let cookies: Cookie[];
  try {
    cookies = await mintSession();
    console.log(`[check-uplift] session minted (${cookies.length} cookies)`);
  } catch (err) {
    console.error(`[check-uplift] auth failed: ${(err as Error).message}`);
    process.exit(2);
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await ctx.addCookies(cookies);

  let href: string | null;
  if (CALLER_OVERRIDE) {
    href = CALLER_OVERRIDE.startsWith("/")
      ? CALLER_OVERRIDE
      : `/x/callers/${CALLER_OVERRIDE}`;
    console.log(`[check-uplift] using override caller ${href}`);
  } else {
    href = await pickFirstCallerHref(ctx);
    if (!href) {
      console.error(
        "[check-uplift] No seed caller found on /x/callers. " +
          "Pass --caller=<id>, HF_CALLER_ID=<id>, or HF_CALLER_HREF=/x/callers/<id>.",
      );
      await browser.close();
      process.exit(2);
    }
    console.log(`[check-uplift] using caller ${href}`);
  }

  let failed = 0;
  for (const tab of TABS) {
    const baselinePath = path.join(BASELINE_DIR, tab.file);
    const currentPath = path.join(CURRENT_DIR, tab.file);

    process.stdout.write(`  [${tab.id.padEnd(12)}] capturing… `);
    const buf = await captureTab(ctx, href, tab.id);
    writeFileSync(currentPath, buf);

    if (UPDATE || !existsSync(baselinePath)) {
      writeFileSync(baselinePath, buf);
      console.log(UPDATE ? "BASELINE UPDATED" : "BASELINE WRITTEN");
      continue;
    }

    const baseline = PNG.sync.read(readFileSync(baselinePath));
    const current = PNG.sync.read(buf);
    const result = diffRatio(baseline, current);

    if (result.sizeMismatch) {
      console.log(`SIZE MISMATCH (baseline ${baseline.width}×${baseline.height} vs current ${current.width}×${current.height})`);
      writeFileSync(
        path.join(DIFF_DIR, `${tab.id}.diff.txt`),
        `SIZE MISMATCH\nbaseline: ${baseline.width}×${baseline.height}\ncurrent:  ${current.width}×${current.height}\n`,
      );
      failed++;
      continue;
    }

    const pct = (result.ratio * 100).toFixed(3);
    if (result.ratio > DIFF_THRESHOLD) {
      console.log(`FAIL  ${pct}% pixels changed (${result.bad}/${result.total})`);
      writeFileSync(
        path.join(DIFF_DIR, `${tab.id}.diff.txt`),
        `${pct}% pixels changed\n${result.bad} of ${result.total} pixels exceeded sum-of-channels tolerance 30/255\nthreshold: ${DIFF_THRESHOLD * 100}%\n`,
      );
      failed++;
    } else {
      console.log(`pass  ${pct}%`);
    }
  }

  await browser.close();

  if (failed > 0) {
    console.error(
      `\n[check-uplift] ${failed} tab(s) exceeded ${DIFF_THRESHOLD * 100}% diff. ` +
        `Inspect:\n  apps/admin/e2e-snapshots/uplift/{baseline,current}/\n` +
        `Accept the change with --update.`,
    );
    process.exit(1);
  }
  console.log(`\n[check-uplift] all ${TABS.length} tabs within ${DIFF_THRESHOLD * 100}% diff.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
