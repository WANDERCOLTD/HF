# Runbook — Connecting Voice Analysis (Prosody)

> **Audience:** operator standing up SpeechAce or SpeechSuper for the first
> time on a HF environment. Most cases this is hf-dev or hf-staging before
> a demo.
> **Time budget:** 20-30 minutes including a verification call.
> **Reversible:** yes — set the provider `enabled: false` to disable. Drops
> the connection without deleting credentials.

## What "connected" means

- A `SpeechAssessmentProvider` row exists with `isDefault: true`,
  `enabled: true`, and valid credentials in the `credentials` JSON column.
- Adapter resolves through `lib/speech-assessment/adapter-registry.ts` —
  today's options are `speechace` and `speechsuper`.
- On every voice call with a `stereoRecordingUrl`, `runProsodyStage`
  ships the audio to the vendor + emits a `VOICE_PROSODY_V1` envelope
  to `Call.voiceProsody`. AGGREGATE step 2.5 writes the appropriate
  `CallScore` rows.

## What "connected" does NOT mean

- It does NOT enable voice analysis for SIM_CALL sessions. Sim calls
  have no audio recording — `runProsodyStage` short-circuits with
  `mode: "unavailable"` and writes nothing. The connection is only
  exercised by real VAPI / WebRTC voice calls.
- It does NOT enable general-mode signals beyond the slots they already
  write. Today (post 2026-06-15) general-mode prosody lands on
  `prosody_pace_wpm` and `prosody_hesitation_rate` — but the vendor
  adapter at `lib/pipeline/prosody-runner.ts:367-373` still hardcodes
  zero for these signals until the adapter extension story merges.
  **IELTS courses are the only end-to-end win on day 1.**

## Step 1 — Pick a vendor + get credentials

| Vendor | Credentials shape | Where to get them |
|---|---|---|
| SpeechAce | `credentials.apiKey` (single string) | https://speechace.com/ — paid plan; per-minute audio billing |
| SpeechSuper | `credentials.appKey` + `credentials.secretKey` | https://www.speechsuper.com/ — paid plan |

Either works for IELTS mode. SpeechAce is the cheaper of the two for
typical IELTS volumes; SpeechSuper's general-mode signals are richer
(better candidate for the vendor-extension follow-on).

## Step 2 — Create the SpeechAssessmentProvider row

### Option A — UI (recommended, ADMIN role required)

1. Navigate to `/x/settings/voice-scoring-providers/new`
2. Fill the form:
   - `slug`: lowercase letters/digits/hyphens (e.g. `speechace-prod`)
   - `displayName`: human label (e.g. `SpeechAce (Prod)`)
   - `adapterKey`: `speechace` or `speechsuper`
   - `credentials`: the vendor credentials JSON shape from the table above
   - `isDefault: true`
   - `enabled: true`
3. Submit. The POST route at `/api/speech-assessment-providers` will
   atomically unset `isDefault` on every other row (`route.ts:116-122`).

### Option B — Direct SQL (faster for hf-dev iteration)

```sql
INSERT INTO "SpeechAssessmentProvider"
  (id, slug, "displayName", "adapterKey", credentials, config,
   "isDefault", enabled, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(),
   'speechace-prod',
   'SpeechAce (Prod)',
   'speechace',
   '{"apiKey":"YOUR_KEY"}'::jsonb,
   '{}'::jsonb,
   true, true, NOW(), NOW());
```

After SQL, run `npx tsx apps/admin/scripts/seed-ielts-prosody.ts --execute`
to flush the cache (the seed script handles `isDefault` consistency too).

### Option C — Use the seed script if a row already exists

```bash
cd apps/admin
npx tsx scripts/seed-ielts-prosody.ts             # dry run (default)
npx tsx scripts/seed-ielts-prosody.ts --execute   # apply
```

The script flips one row to `isDefault: true` if none is set; safe to
re-run.

## Step 3 — Set tierPresetId on IELTS courses (only if not already set)

The same seed script handles this:

```bash
npx tsx scripts/seed-ielts-prosody.ts --execute
```

For any Playbook matching `/ielts/i` whose `Playbook.config.tierPresetId`
is unset, it sets `tierPresetId: "ielts-speaking"`. This is what triggers
the IELTS-mode branch in `lib/pipeline/prosody-runner.ts::resolveProsodyMode`.

## Step 4 — Verify with a test call

Run a real VAPI voice call against an IELTS-tagged course (sim calls
don't exercise prosody — they have no audio). On hf-dev:

1. `/x/settings/voice-tools` — confirm SpeechAce shows green.
2. Run an outbound or inbound voice call against an IELTS playbook.
3. After the call ends, query:

   ```sql
   SELECT id,
          "voiceProsody"->>'mode' AS mode,
          "voiceProsody"->>'errorReason' AS error
   FROM "Call"
   WHERE "createdAt" > NOW() - INTERVAL '10 minutes'
   ORDER BY "createdAt" DESC
   LIMIT 5;
   ```

   Expect `mode = "ielts"` with `error = NULL`. Anything else means the
   connection or routing isn't right — see troubleshooting below.

4. Check CallScore rows landed for the 4 IELTS skills:

   ```sql
   SELECT cs."parameterId", cs.score, cs."scoredBy"
   FROM "CallScore" cs
   WHERE cs."callId" = '<the call id from step 3>'
     AND cs."parameterId" LIKE 'skill_%';
   ```

   Expect 4 rows: `skill_fluency_and_coherence_fc`,
   `skill_pronunciation_p`, `skill_lexical_resource_lr`,
   `skill_grammatical_range_and_accuracy_gra` with non-zero scores.

5. Test connection without a real call: hit
   `POST /api/speech-assessment-providers/[id]/test-connection` (ADMIN
   role; pings the vendor).

## Step 5 — Confirm `priorCallFeedback` consumes the signals on the NEXT call

Trigger a second call against the same caller. The composed prompt for
that call should include a `priorCallFeedback` section noting "your
weakest area was [skill]" — drawn from the prior call's `skill_*`
CallScore rows via `lib/prompt/composition/loaders/priorCallFeedback.ts:206-215`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `mode: "unavailable"`, `errorReason: "no_recording"` | Sim call (no audio) — expected | Test with a real voice call |
| `mode: "unavailable"`, `errorReason: "no_provider_configured"` | No `isDefault: true` row | Re-run seed script or set via UI |
| `mode: "unavailable"`, `errorReason: "vendor_timeout"` | Vendor took > 30s to respond | Check vendor status; if persistent, raise `VoiceSystemSettings.vendorTimeoutMs` (default 30000ms) |
| `mode: "unavailable"`, `errorReason: "vendor_error"` | Auth, network, or quota failure | Check vendor dashboard; check `Call.voiceProviderRaw` JSON for vendor's error message |
| `mode: "general"` instead of `"ielts"` on an IELTS course | `tierPresetId` not set | Re-run seed script with `--execute`; check `Playbook.config.tierPresetId` in DB |
| CallScore rows have score=0 for `prosody_pace_wpm` / `prosody_hesitation_rate` | Vendor adapter doesn't expose general-mode signals yet | Expected — see `prosody-runner.ts:367-373`. Vendor-extension story tracks this |
| `priorCallFeedback` recap shows nothing | Less than 2 calls on the caller against this playbook | Run a second call |

## Cost ceiling

`VoiceSystemSettings.maxCostPerCallUsd` caps cost per call. SpeechAce ≈
$0.018 / minute typical. A 15-minute IELTS speaking call ≈ $0.27 raw
scoring cost — set the cap with headroom (`0.50` or higher) to avoid
spurious aborts.

## Verbose voice diagnostics

If a call is mysteriously hitting `mode: "unavailable"` and the SQL
above doesn't show why, enable verbose voice traces per `CLAUDE.md` ->
`Debugging — verbose voice diagnostics (VOICE_DIAG_VERBOSE)`. Flip OFF
after diagnosis — verbose mode logs every payload.

## Reverting

Set `enabled: false` on the SpeechAssessmentProvider row:

```sql
UPDATE "SpeechAssessmentProvider"
SET enabled = false, "updatedAt" = NOW()
WHERE slug = 'speechace-prod';
```

Or in the UI: `/x/settings/voice-scoring-providers/[id]` → toggle
Enabled off. Credentials stay in the row for re-enabling later.
`runProsodyStage` will short-circuit with `mode: "unavailable"`,
errorReason `no_provider_configured`. Pipeline continues; no rows
written.

## Related

- `lib/pipeline/prosody-runner.ts::runProsodyStage` — the stage code path
- `lib/pipeline/prosody-consumer.ts::applyProsodyContractToAggregate` —
  what does the writing
- `scripts/seed-ielts-prosody.ts` — idempotent setup for the 2 most
  common pre-conditions
- `docs/draft-issues/prosody-skill-mapping.md` — the proposed
  `Playbook.config.voice.prosodySkillMap` follow-on
- `docs/CHAIN-CONTRACTS.md` §6 I-AL4 — observability invariant for
  prosody skips
