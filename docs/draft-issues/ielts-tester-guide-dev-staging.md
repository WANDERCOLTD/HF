# IELTS Tester Guide — DEV (hf_staging) state vs Gap Analysis

**Date:** 2026-06-19
**Audience:** Boaz, Eldar, and other pre-voice testers
**Base URL:** `https://dev.humanfirstfoundation.com`
**DB binding:** `dev.humanfirstfoundation.com` → `hf_staging` (since 2026-06-19 08:43 UTC pivot)
**Login:** `admin@test.com` / `admin123` (5 SUPERADMINs seeded — also `boaz@tal.biz`, `eldar.gilad@gmail.com`, `b@test.com`, `e@test.com`)
**IELTS playbook ID:** `cbca5851-9bcc-49b0-a954-20ec150492bd`

## Source documents

- **Gap analysis (original):** [`docs/draft-issues/ielts-pre-voice-gap-analysis.md`](./ielts-pre-voice-gap-analysis.md)
- **Partner response (latest):** [`docs/draft-issues/ielts-pre-voice-gap-analysis-response-2026-06-18.md`](./ielts-pre-voice-gap-analysis-response-2026-06-18.md)
- **Mid-week progress snapshot:** [`docs/draft-issues/ielts-pre-voice-gap-analysis-progress-2026-06-16.md`](./ielts-pre-voice-gap-analysis-progress-2026-06-16.md)

This doc is the **operator-facing cross-check**: each row from the partner response mapped to a concrete DEV URL the tester can click, plus what they should see.

---

## §1 — Boaz/Eldar rows we claim are SHIPPED (verify these first)

| Boaz row | Claim | DEV URL | What to check |
|---|---|---|---|
| **Unit 2 #1** — Part 1 question-count minimum (10) | ✅ #1748 (`81fe52b2`) | [Course detail](https://dev.humanfirstfoundation.com/x/courses/cbca5851-9bcc-49b0-a954-20ec150492bd) → Module Inspector for `part1` | Inspector shows question-count counter knob (G7 row) |
| **Unit 5 #1** — Exam shell (dual waveform, hidden timers) | ✅ #1745 Theme 4 (`71fb087a` + `b56137e3`) | Run Mock sim via `/x/sim/<callerId>` (need a caller first — see "How to run end-to-end" below) | Mock screen renders dual waveform; timers NOT visible to learner |
| **Unit 5 #2** — Unlock gates (Assessment + 2 P1 + 2 P3) | ✅ #1746 Theme 5 (`0d8a0de3` + `9f7b817f`) | Create non-OPERATOR caller → try to start Mock from `/x/callers/<callerId>` | Locked until 1 baseline + 2 P1 + 2 P3 completed; OPERATOR bypass available |
| **Unit 5 #4** — Persisted-band writer | ✅ #1823 (`64f41a6c`) | After a Mock completion, hit `/api/sessions/<sessionId>/results` or query `Session.metadata.overallBand` directly | Field populated after pipeline AGGREGATE; previously computed live only |
| **Cross-cutting B** — Tester workbench | ✅ #1812 (`067952f3`) + #1750 (`419d42df`) + `cloneDemoCaller` (`180d5da0`) | [Tester workbench](https://dev.humanfirstfoundation.com/x/test) | Tester index renders; can clone a demo caller and direct-link into sim |
| **Part 2 build #2** — Timed voice lines spike | ✅ #1742 (`9fbc7580`) + #1743 (`fefe6a09`) + ADR `e9e5ebc6` | Run Part 2 sim, watch tutor cue announcements | Tutor says cue card prompt + handles stalls |

**Boaz's three corrections (don't rebuild) — DEV URLs to verify still alive:**

| Item | DEV URL / probe |
|---|---|
| Unit 4 weakest-skill rail (3 transforms consume per-LO mastery) | After a sim run, view composed prompt at course detail → Compose / Preview tab |
| Unit 5 overall band live route + persisted writer | Run Mock → `GET /api/sessions/<sessionId>/results` (route exists per #1751) |
| No spoken band needed | Confirmed by reading composed prompt — should NOT include "your band is X" line |

---

## §2 — The 4 blockers BEING BUILT (these should NOT yet pass testing)

| # | Story | Boaz refs | Expected NOW on DEV | Test acknowledgement |
|---|---|---|---|---|
| 1 | [#1953](https://github.com/WANDERCOLTD/HF/issues/1953) Four-criteria IELTS completion gate | U1.2 + U5 + Cross-cutting A | NOT live — `validationPassed` reports `true` but doesn't check 4 criteria yet | Mock completion currently flips status COMPLETED even with missing criteria — testers should reproduce |
| 2 | [#1954](https://github.com/WANDERCOLTD/HF/issues/1954) Post-Assessment lesson-plan trigger | U1.1 + U2.4 (TBD) | NOT live — Results screen exists but no "next steps" panel | After Assessment, `/x/callers/<callerId>/result/<sessionId>` shows results but no plan-refresh panel |
| 3 | [#1955](https://github.com/WANDERCOLTD/HF/issues/1955) Part 3 focus selector + on-screen pin | U4.1 + U4.2 | NOT live — `PinnedCardContent` type exists, slot is empty | Part 3 sim shows no focus-area banner |
| 4 | [#1956](https://github.com/WANDERCOLTD/HF/issues/1956) `silentMode` knob | U1.3 | NOT live — IELTS config on staging confirmed `silentMode: NOT SET` | Baseline assessment opens with "this is a test" wording |

**Current build sequence (per §5 of the response):** #1956 → #1953 → #1954 → #1955. Q3 must resolve before #1956 starts; Q2 must resolve before #1955 starts.

---

## §3 — Phase-2 carve-outs (do NOT test for these — they are deliberately deferred)

| Item | Boaz row | Reason for Phase-2 |
|---|---|---|
| Part 2 multi-card loop orchestrator | U3.1 | Phasing pushback — single-card v1 tests the behaviours; loop is +8 dev-days |
| Per-card prep minute | U3.2 | Single card gets one prep minute = unit test of behaviour |
| Per-segment Part 2 scoring | U3.3 | Single-card aggregate ships; per-segment infra is the Phase-2 piece |
| 30-sec continuous talk-cap prompt | U2.2 | Boaz himself rated "n/s blocker" |
| % session talk-time post-analysis | U2.3 | Boaz rated Low/No-blocker; tutor-side already shipped via Theme 7 (#1747) |
| Friendly part labels on results | U5.3 | Polish, Boaz rated Low/Low/No-blocker |

---

## §4 — Open decisions (waiting on partner answer — these are not testable yet)

| Q | Story | Decision needed |
|---|---|---|
| Q1 | #1954 | ASSESSMENT-only / every session / per-module toggle? **Recommended:** per-module G8 toggle, default ON for ASSESSMENT |
| Q2 | #1955 | Part 3 LOs tagged with skill `parameterId`? Confirm OR commit to +2h tagging chore |
| Q3 | #1956 | Ship IELTS baseline_assessment with `silentMode: true` as seed default? **Recommended:** YES |

---

## Live IELTS playbook config on hf_staging (what testers will actually see)

| Field | Value | Gap-analysis impact |
|---|---|---|
| `firstCallMode` | NOT SET | Cascade-default will pick — likely defaults to baseline_assessment |
| `silentMode` | NOT SET | Q3 unanswered — current behaviour: tutor announces "this is a test" |
| `sessionFlow.intake` | `{aboutYou: true, knowledgeCheck: true}` | Wizard runs both intake steps |
| `welcome` | `{goals:enabled, aboutYou:enabled, aiIntroCall:disabled, knowledgeCheck:disabled}` | Journey-rail intake (modern shape — NOT the legacy `welcomeMessage` string) |
| `interactionPattern` | `tutor` | Default cross-module mode |
| `progressionMode` | `learner-picks` | Learner can pick any module after baseline |
| `moduleDefaults` | `{mode:tutor, bandVisibility:hidden_mid_module, theoryDelivery:embedded_only, correctionStyle:single_issue_loop}` | All four match Theme 1 IELTS author intent |

## Module modes (per current IELTS playbook on DEV)

| Module | Mode | Duration | Reflects gap analysis? |
|---|---|---|---|
| `baseline` | examiner | 20 min | ✓ (Unit 1) |
| `part1` | tutor | Student-led | ✓ (Unit 2 — question-counter visibility check at Module Inspector) |
| `part2` | mixed | Student-led | ✓ (Unit 3 — single-card v1, multi-card deferred) |
| `part3` | tutor | Student-led | ✓ (Unit 4 — focus banner pending #1955) |
| `mock` | examiner | 15 min | ✓ (Unit 5 — shell live, gate pending #1953) |

---

## How to run an end-to-end behaviour check

```
1. Login: https://dev.humanfirstfoundation.com/login
     credentials: admin@test.com / admin123
       (or b@test.com, e@test.com, boaz@tal.biz, eldar.gilad@gmail.com — all admin123)

2. Open tester workbench: https://dev.humanfirstfoundation.com/x/test

3. Clone demo caller (gives a fresh Caller with IELTS playbook attached)

4. Direct-link into sim: https://dev.humanfirstfoundation.com/x/sim/<callerId>

5. Run modules in order: baseline → part1×2 → part3×2 → mock

6. After each session, verify the Results screen:
     https://dev.humanfirstfoundation.com/x/callers/<callerId>/result/<sessionId>

7. After Mock, check the three §2 absences are reproduced:
     - overallBand persisted (DB-side; query Session.metadata.overallBand)
     - lesson-plan "next steps" panel (CURRENTLY ABSENT — pending #1954)
     - completion gate honest about 4 criteria (CURRENTLY MISSING — pending #1953)
```

## Quick-paste browser links

| Target | URL |
|---|---|
| Login | <https://dev.humanfirstfoundation.com/login> |
| Tester workbench | <https://dev.humanfirstfoundation.com/x/test> |
| IELTS course detail | <https://dev.humanfirstfoundation.com/x/courses/cbca5851-9bcc-49b0-a954-20ec150492bd> |
| IELTS journey tab | <https://dev.humanfirstfoundation.com/x/courses/cbca5851-9bcc-49b0-a954-20ec150492bd/journey> |
| Caller index | <https://dev.humanfirstfoundation.com/x/callers> |
| Course catalogue | <https://dev.humanfirstfoundation.com/x/courses> |
| Full partner-response doc (GitHub) | <https://github.com/WANDERCOLTD/HF/blob/main/docs/draft-issues/ielts-pre-voice-gap-analysis-response-2026-06-18.md> |

---

## What testers should send back

1. **Mark each §1 row green/red after running its behaviour check** — these are SHIPPED claims, fastest disprove path. Cite the URL you tested.
2. **Confirm §2 rows are NOT yet behaving** (expected red — these are the 4 stories in flight). Any green here is a surprise worth flagging.
3. **Answers to §4 Q1/Q2/Q3** — these block #1955 and #1956 from starting.

## Demo set on DEV (for context)

4 playbooks PUBLISHED on hf_staging (post 2026-06-19 prune):

| Playbook | Institution | Notes |
|---|---|---|
| **IELTS Speaking Practice** | IELTS Prep Lab | 5 modules, healthy — the one this guide covers |
| Spot the Spin | Abacus Academy | 5 modules, healthy |
| Big Five (OCEAN) Personality Model | PAW Training Ltd | 6 modules, healthy |
| The CIO/CTO Standard — Revision Aid | FC Academy | 0 modules currently — Units import blocked on slug-regex mismatch ([#2021](https://github.com/WANDERCOLTD/HF/issues/2021)) |

**Unpublished (DRAFT) on staging:**
- Introduction to Psychology (0 modules — broken)
- CIO/CTO Pop Quiz (`Mode:quiz` not yet wired — [#2009](https://github.com/WANDERCOLTD/HF/issues/2009))
- CIO/CTO Exam Assessment (`Mode:mock-exam` not yet wired — [#2009](https://github.com/WANDERCOLTD/HF/issues/2009))

---

## Rollback paths (in case something behaves badly during testing)

```bash
# DB pivot — revert DEV to sandbox if staging surfaces a regression
gcloud run services update hf-admin-dev --region=europe-west2 --project=hf-admin-prod \
  --update-secrets="DATABASE_URL=DATABASE_URL_SANDBOX:latest"

# Re-publish a DRAFT playbook (if you want to test variants)
COOKIES=/tmp/hf-cookies.txt  # see CLAUDE.md "You CAN hit authenticated API routes" for the login dance
curl -sS -b $COOKIES -X PATCH "https://dev.humanfirstfoundation.com/api/playbooks/<id>" \
  -H "Content-Type: application/json" -d '{"status":"PUBLISHED"}'
```

---

*Generated 2026-06-19 by the LastParms session after the DEV pivot. State reflects hf_staging at the moment of writing — re-run probes if more than a few hours have passed.*
