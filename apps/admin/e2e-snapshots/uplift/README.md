# Caller Insights — Visual Baselines

Tracked PNG baselines for the five caller-insight tabs (Overview, v1 Uplift,
v1 Progress, v2 Uplift BETA, v2 Progress BETA).

Captured and compared by `apps/admin/scripts/check-uplift-visual.ts`. The
script bypasses the Playwright test harness — auth is minted via the
NextAuth credentials API and a session cookie is injected into a headless
Chromium context. No fixture, no global-setup, no UI login flow.

## Usage

```bash
# from apps/admin/ — VM tunnel on localhost:3000 required
npm run check:uplift                              # diff vs baseline
npm run check:uplift:update                       # refresh / accept changes

# Pin a specific caller (bypasses /x/callers discovery)
HF_CALLER_ID=<id> npm run check:uplift
```

**Important:** The VM dev server must be running the branch you want to
screenshot. If the VM is on a stale branch (e.g. you've committed locally
but not run `/vm-cp` / `/vm-pull`), unknown tab ids like `?tab=uplift-v2`
will silently fall back to the default `?tab=what` and your "v2" baseline
will actually be a Progress v1 capture. Confirm by checking that the
captured PNGs are NOT byte-identical (`md5 -r baseline/*.png`).

Workflow:

1. Before a UI PR: ensure `baseline/` is current. Capture it once after each
   accepted intentional change with `--update`.
2. After the PR: run without `--update`. Exit 0 = no visual regression.
   Exit 1 = one or more tabs exceeded the 0.5% pixel-diff threshold; the
   script writes `current/<tab>.png` and `diff/<tab>.diff.txt` so you can
   inspect.
3. Compare `baseline/` vs `current/` visually for changed tabs; accept the
   new state with `--update`.

## Directory layout

```
baseline/       tracked in git — the accepted state
current/        ignored — last run output
diff/           ignored — per-tab failure summaries
```

## Threshold

`DIFF_THRESHOLD = 0.5%` of pixels with a sum-of-RGB-channels delta > 30.
Tuned to survive font anti-alias noise while catching real layout drift.
