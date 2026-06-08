# 2026-06-08 — Default TTS swapped from ElevenLabs to Deepgram Aura Asteria

**Status:** DECIDED — shipped without prior subjective listening; rollback is one config flip per env.

**Story:** [#1334](https://github.com/WANDERCOLTD/HF/issues/1334)

## Context

VAPI's default TTS is ElevenLabs Multilingual v2 at ~$0.18/min — the single largest line item on a typical voice minute. Deepgram Aura and OpenAI TTS sit at ~$0.015/min — same audio quality tier per public listening tests, ~12× cheaper. Both are VAPI-native (no extra dashboard setup; same VAPI account).

The cascade work in `lib/voice/config.ts::resolveVoiceConfig` already plumbs `voiceProvider` + `voiceId` from `VoiceProvider.config` through to `lib/voice/providers/vapi/index.ts:192-209`, which weaves the keys into the inline assistant config passed to `vapi.start()`. So the swap is a single `VoiceProvider.config` JSON update — no code change.

Today the VAPI row has `config: {}` (per `prisma/seed-voice-providers.ts`) — meaning every call falls through to VAPI's default ElevenLabs. The pilot sets specific values; the winner becomes the new default.

## Candidates

| Engine | Voice ID | Voice profile | List price (per VAPI dashboard) |
|---|---|---|---|
| **ElevenLabs Multilingual v2** (baseline) | `21m00Tcm4TlvDq8ikWAM` (Rachel) | Female, warm, US English | ~$0.18/min |
| **Deepgram Aura** | `aura-asteria-en` | Female, conversational, US English | ~$0.015/min |
| **OpenAI TTS-1** | `nova` | Female, warm, US English | ~$0.015–0.018/min |

Voice IDs picked for gender + warmth parity so subjective judgement isn't confounded by voice persona. If the winner happens to be Deepgram, the secondary "which Aura voice" round (Asteria / Luna / Stella / Athena / Hera) is a follow-on, not part of this pilot.

**Excluded:**
- `azure` and `playht` (VAPI schema enum supports them, but TL confirmed both need extra dashboard API-key linkage — out of scope for this pilot).
- ElevenLabs Turbo v2 (~$0.05/min) — interesting middle ground, but Aura/Nova at $0.015/min dominate it on cost; if both lose on quality grounds we can revisit Turbo.

## Operator runbook

Pre-req: operator running `/x/sim/<callerId>` against a test caller on `dev.humanfirstfoundation.com` (or local VM via `localhost:3000` tunnel). At least one VAPI VoiceProvider row already seeded (verify at `/x/settings/voice-providers`).

### For each candidate (run all 3 in sequence — baseline first)

1. **Set the candidate** at `/x/settings/voice-providers/<vapi-row-id>`:
   - `voiceProvider` → enum value (`11labs` / `deepgram` / `openai`)
   - `voiceId` → string from candidates table above
   - Save. Provider-cache TTL is 5 min; either wait or click the cache-bust button (factory has `invalidateVoiceProviderCache(slug)`).

2. **Run 5 smoke calls** via `/x/sim/<callerId>` → **[Talk Here]** (WebRTC):
   - Same test caller, same playbook, same prompt seed each run.
   - Speak 2–3 conversational turns per call (~30–60 seconds each).
   - End each call cleanly so the end-of-call webhook fires and cost telemetry posts.

3. **Capture data per call** in the results table below:
   - Total call cost (USD) → from `/x/settings/ai-costs` filtered to this call. Note: this is AGGREGATE (TTS + STT + LLM combined). Relative TTS cost is the difference between candidates with STT + LLM held constant.
   - Call duration (seconds) → same surface.
   - Computed $/min = cost / (duration / 60).
   - Subjective quality (1–5) per dimension:
     - Naturalness — does it sound human, not robotic?
     - Warmth — does it feel like a tutor, not a kiosk?
     - Pronunciation — does it handle the prompt's vocabulary (course terms, names)?
     - Latency — perceived time-to-first-sound after learner's turn end.
     - Consistency — does it sound the same across utterances within the same call?

4. **Listen on speakers AND headphones** for at least one call per candidate — small-speaker artefacts hide in headphones and vice versa.

5. **One listener with educator perspective** rates each candidate's first call. (Operator can self-rate the other 4 if needed.)

### Results template (fill during pilot — replace this block before merge)

```
ELEVENLABS RACHEL (baseline)
  Calls: __ / 5
  Mean $/min: ___
  Median $/min: ___
  Naturalness avg: _._
  Warmth avg: _._
  Pronunciation issues: ___
  Latency avg: _._
  Consistency: _._
  Notes:

DEEPGRAM AURA ASTERIA
  Calls: __ / 5
  Mean $/min: ___
  Median $/min: ___
  Naturalness avg: _._
  Warmth avg: _._
  Pronunciation issues: ___
  Latency avg: _._
  Consistency: _._
  Notes:

OPENAI NOVA
  Calls: __ / 5
  Mean $/min: ___
  Median $/min: ___
  Naturalness avg: _._
  Warmth avg: _._
  Pronunciation issues: ___
  Latency avg: _._
  Consistency: _._
  Notes:
```

### Picking the winner

Decision rule:
- If any candidate drops naturalness or warmth below 3/5, exclude it from cost ranking — learner engagement matters more than per-minute savings.
- Among remaining candidates, pick lowest mean $/min.
- If two candidates tie on cost within 10%, pick the one with higher composite quality score.

### Locking it in

Once the winner is chosen, set the system default by updating `VoiceProvider.config` on the VAPI row at `/x/settings/voice-providers/<vapi-row-id>` to the winning `voiceProvider` + `voiceId`. Provider cache busts immediately on save (POST/PATCH/DELETE invalidate). Verify on the next live call via cost telemetry that the new $/min holds.

Document the values here in the `## Decision` section below; remove the `PILOT IN PROGRESS` status flag from the header; update MEMORY.md `## Now` block with the win.

## Decision

**Default voice swapped to `voiceProvider: "deepgram"` + `voiceId: "aura-asteria-en"`** at three levels of defence:

1. **Schema default** at `lib/voice/providers/vapi/index.ts:436` — `voiceProvider.default = "deepgram"`. The cascade resolver's last-resort fallback (`resolveVoiceConfig` → `schemaField.default`) returns Deepgram for any environment whose VoiceProvider row pre-dates this work with an empty config blob.
2. **Seed bootstrap** at `prisma/seed-voice-providers.ts` — new environments (TEST, PROD when provisioned) get an explicit `config: { voiceProvider: "deepgram", voiceId: "aura-asteria-en" }` from day one. Idempotent — never overwrites an existing row.
3. **One-off migration script** at `scripts/migrate-vapi-tts-default.ts` — for existing envs (`hf_sandbox`, `hf_staging`) where the row was seeded pre-#1334 with `config: {}`. Idempotent; respects operator-set values. Run via `npx tsx apps/admin/scripts/migrate-vapi-tts-default.ts` on each env after deploy.

**Lock tests** at `tests/lib/voice/vapi-config-cascade.test.ts`:
- Schema default is `"deepgram"`.
- When the seed-bootstrapped config flows through, the adapter writes `voice: { provider: "deepgram", voiceId: "aura-asteria-en" }` to VAPI.

### Why Deepgram Aura Asteria, picked without live A/B

The runbook below describes the ideal pilot — three candidates, five calls each, subjective ratings. This was bypassed in favour of shipping on public evidence so the cost win lands now and downstream cascade work (#1335) doesn't queue behind a manual measurement. The evidence basis:

| Factor | Why Deepgram Aura Asteria wins on paper |
|---|---|
| Cost | ~$0.015/min vs ElevenLabs ~$0.18/min — 12× cheaper |
| Latency | Deepgram TTS is co-located with Deepgram STT (HF's default `transcriber: "deepgram"`); no cross-vendor round-trip on each turn |
| Tuning | Aura voices are explicitly designed for conversational AI (Deepgram's positioning), not narration (which is OpenAI TTS's target) |
| Availability | VAPI-native, no extra dashboard API-key linkage required (unlike `azure` / `playht`) |
| Reversibility | If subjective quality regresses, one config flip per env restores ElevenLabs Rachel — no code change, no deploy |
| Signal capture | Cost telemetry will show the new per-minute number on the next live calls — we'll know within hours whether the saving materialised |

### Validation gap, acknowledged

No subjective quality rating was captured before flipping. If a real-call user reports the new voice sounds robotic, off-tone for the tutor persona, or mispronounces course-specific vocabulary, the rollback path is:

```
/x/settings/voice-providers/<vapi-row-id>
  voiceProvider → "11labs"
  voiceId → "21m00Tcm4TlvDq8ikWAM"  (Rachel)
Save. Next call picks it up (provider cache invalidates on PATCH).
```

The runbook section below stays in this ADR — if quality complaints land, run the 3-candidate × 5-call protocol to pick between Deepgram (current), ElevenLabs (premium fallback), and OpenAI Nova (middle ground). Update the decision block with the data.

### Sign-off

- Decision authority: PM (Paul) requested this be shipped without manual pilot via the [#1334 sprint discussion](https://github.com/WANDERCOLTD/HF/issues/1334).
- Reviewer: Tech Lead agent confirmed the cascade plumbing is fully wired and the swap is single-config-flip reversible ([review comment](https://github.com/WANDERCOLTD/HF/issues/1334#issuecomment-4650299662)).
- Date: 2026-06-08.

### Baseline data (captured post-merge, pre-migration effect)

Pulled from `hf_sandbox.Call.voiceCostUsd / voiceDurationSeconds` via `/tmp/vm-cost-baseline.sh` immediately after the migration ran on the VM but before any post-migration calls had completed. So this is the **pre-migration** baseline — every call here used the prior default (VAPI's underlying ElevenLabs).

Last 30 days, 21 calls with cost data, 8 of those ≥ 30 seconds:

| Metric | $/min |
|---|---|
| Mean (n=8) | **$0.0933** |
| Median | $0.0905 |
| Min | $0.0828 |
| Max | $0.1137 |

**Reality check on the original $0.18/min estimate.** This ADR opened by quoting "~$0.18/min" as the ElevenLabs price point and "~12× cheaper" as the framing. The measured bundled cost is **$0.093/min** — about half what the ADR estimated. VAPI is presumably using ElevenLabs Turbo (~$0.05/min) and/or volume pricing, not Multilingual Standard. The TTS-only line in the bundle is therefore closer to $0.05/min, not $0.18/min.

**Updated projection** (TTS-only swap, holding STT + LLM constant at their bundled rates):
- Old TTS contribution: ~$0.05/min (ElevenLabs Turbo via VAPI)
- New TTS contribution: ~$0.015/min (Deepgram Aura via VAPI)
- Per-min saving: ~$0.035/min
- New projected total: **~$0.058/min** vs **$0.093/min** baseline = **~37% reduction**, not 90%.

Real saving will be in the next 5–10 post-migration calls. Re-run `/tmp/vm-cost-baseline.sh` then to confirm.

### Open follow-on: UsageEvent.costCents not populated for VOICE

While capturing the baseline, found that `UsageEvent` has 1,334 rows in the last 30 days with `category = "VOICE"` and **all rows have `costCents = 0`**. The cost data lives on `Call.voiceCostUsd` (canonical post-#1020 column) and that's the only authoritative source today. `processStatusUpdate` in `lib/voice/route-handlers.ts:262` writes `costCents` per status-update event but those writes aren't materialising in the table. Worth a focused look if we want per-component (TTS / STT / LLM) cost breakdowns rather than per-call totals. Not blocking — Call.voiceCostUsd works for #1334 measurement.

## Risks + footguns

- **Voice ID provider-mismatch:** setting `voiceProvider: "deepgram"` with an ElevenLabs voice ID (or vice versa) results in a silent failure inside VAPI's TTS layer — calls connect, no audio, learner hears nothing. Today there's no form-level validation. Mitigation: copy the voice ID exactly from this ADR; double-check both fields are saved together. Follow-on: file a form-validation issue if the pilot trips this footgun.
- **`voiceId` help text drift:** `lib/voice/providers/vapi/index.ts:428` help text still reads "ElevenLabs voice ID" — needs update to "voice ID for the selected `voiceProvider` engine" once a non-11labs winner is picked. File as small follow-on; not blocking.
- **Cost telemetry is aggregate** — VAPI's `message.cost` bundles TTS + STT + LLM. Relative TTS comparison only valid when STT + LLM are held constant across candidates (which the runbook above enforces by using the same test caller + same playbook).
- **WebRTC vs PSTN:** pilot runs on `[Talk Here]` (WebRTC) only. PSTN dial-in/out uses the same TTS config so results should generalise, but a 1-call PSTN smoke test before locking in the winner is cheap insurance.
- **Voice persona drift for in-flight callers:** changing the system default mid-pilot affects every active caller's next call. If you have learners with strong attachment to the current voice, stage the rollout via Domain or Course override using the same `config.voice` keys (#1335 Slice 2 lights up that surface) — but for the pilot this is overkill.

## Rollback

One-line revert:
1. `/x/settings/voice-providers/<vapi-row-id>` → restore `voiceProvider: "11labs"` + `voiceId: "21m00Tcm4TlvDq8ikWAM"` (or clear both keys to fall back to VAPI's default).
2. Save. Cache invalidates. Next call uses ElevenLabs again.

No code, no deploy, no migration — pure config flip.

## References

- Story: [#1334](https://github.com/WANDERCOLTD/HF/issues/1334)
- Cascade source: `lib/voice/config.ts` (`resolveVoiceConfig`)
- Adapter weave: `lib/voice/providers/vapi/index.ts:192-209` (`buildAssistantConfig` voice block)
- Cost telemetry: `lib/voice/route-handlers.ts:262` (`processStatusUpdate`) → `/x/settings/ai-costs`
- Provider seed: `prisma/seed-voice-providers.ts`
- Schema field help: `lib/voice/providers/vapi/index.ts::getConfigSchema` (lines 384–470)
