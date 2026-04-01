---
title: "HF Market Test Phase 1 — Gap Analysis"
subtitle: "Boaz Spec vs Current System State"
date: "31 March 2026"
author: "Paul Wander"
---

# HF Market Test Phase 1 — Gap Analysis

**Purpose:** Systematic verification of every Phase 1 requirement in Boaz's Market Test Specification (30 March 2026) against the current HF system.

**Verdict:** Phase 1 is ~95% complete. Three gaps remain, all fixable in under a day.

---

## 1. Environment Separation (Spec &sect;1.2)

| Requirement | Status | Notes |
|---|---|---|
| Stable test environment with own DB | **Ready** | TEST env exists: `test.humanfirstfoundation.com`, separate Cloud SQL instance |
| Independent of Paul's dev deployments | **Ready** | DEV and TEST are separate Cloud Run services with separate databases |
| Data persists across testing days | **Ready** | Standard Cloud SQL persistence |

**Action:** Deploy current codebase to TEST env once, then leave it stable.

---

## 2. Auth Level (Spec &sect;1.3)

| Requirement | Status |
|---|---|
| Boaz operates as SUPERADMIN | **Done** |
| Full access to admin views, sim, and inspection | **Done** |

No gaps.

---

## 3. Test Course Creation (Spec &sect;1.4)

| Requirement | Status | Location |
|---|---|---|
| Create one course via wizard | **Done** | GS V5 wizard at `/x/get-started-v5` |
| Upload content (not text-heavy) | **Done** | PDF/doc upload with AI extraction |
| AI samples intelligently, no cap on learning points | **Done** | Extraction is uncapped |
| Course is agnostic (no subject mandated) | **Done** | Wizard accepts any subject |

No gaps.

---

## 4. Onboarding (Spec &sect;1.5)

| Requirement | Status | Location |
|---|---|---|
| Magic link landing page | **Done** | `/join/{token}` |
| Learner provides name and email | **Done** | Form captures firstName, lastName, email |
| System uses details in personalisation | **Done** | Caller name injected into prompt via `buildCallerContext()` |
| Tester controls learner identity | **Done** | Free-text form fields |
| Auto-enrollment in course | **Done** | `enrollCallerInCohortPlaybooks()` on join |

No gaps.

---

## 5. Testing Loop (Spec &sect;1.6)

| Step | Requirement | Status |
|---|---|---|
| 1 | Click magic link, provide learner details | **Done** |
| 2 | First session — AI greets with course-specific message | **Done** |
| 3 | Inspect composed prompt for next session | **Done** |
| 4 | Second session — AI reflects adapted prompt | **Done** |
| 5 | Inspect further adaptation | **Done** |
| 6 | Repeat through all sessions | **Done** |
| 7 | Reset and restart | **Partial** (see &sect;8) |

| Behaviour | Status |
|---|---|
| Full run-through (all sessions sequentially) | **Done** |
| Pause and resume (leave, come back later) | **Done** — CallerIdentity preserves nextPrompt + callCount |

---

## 6. Prompt Inspection (Spec &sect;1.7)

| Requirement | Status | Location |
|---|---|---|
| Self-service access to composed prompt | **Done** | Prompt Navigator on caller detail page |
| No Paul involvement needed | **Done** | Click learner in roster, open Prompt Navigator |
| Shows full prompt for next session | **Done** | Three views: Summary, Voice Prompt, Raw JSON |
| Can compare between sessions | **Done** | Diff mode shows line-level changes |

No gaps.

---

## 7. Course Detail Page — Tab Summary

After creating and launching a course, the admin sees:

| Tab | Contents | Market Test Use |
|---|---|---|
| **Overview** | Subjects, specs, persona, session plan summary | Quick health check |
| **Onboarding** | Welcome message, flow phases | Verify first-call experience |
| **Content** | Sources, extracted teaching points by method, upload | Upload and verify content |
| **Sessions** | Session-by-session plan with TPs and images, drag-drop | Inspect session structure |
| **Cohort** | Audience settings, persona, behavior targets | Configure AI's learner model |
| **Learners** | Join link (copy), email invites, enrolled/invited roster, stats | Onboarding + learner management |
| **Proof Points** | Confidence lift, engagement, satisfaction, CSV export | Evidence dashboard |
| **Goals** | Learning goals per course | Track what's being measured |
| **Settings** | Operator-only configuration | Tweaks |

---

## 8. Student Reset (Spec &sect;1.8) &mdash; GAP

| Requirement | Status | Gap? |
|---|---|---|
| Wipe all session data | **Done** | CallScores, RewardScores, BehaviorMeasurements cleared |
| Wipe pipeline outputs | **Done** | Personality, memories, targets cleared |
| Wipe composed prompts | **Done** | ComposedPrompts deleted |
| Wipe mastery progress | **Gap** | CallerAttribute + CallerModuleProgress **not cleared** |
| Wipe goal progress | **Gap** | Goal progress data **not cleared** |
| Restart from onboarding | **Partial** | CallCount reset to 0, but curriculum state persists |
| Self-service | **Done** | Reset button on caller roster |

**Impact:** After reset, the AI won't truly behave like a fresh first session if curriculum tracking data persists. Boaz would see stale mastery state bleeding into the "reset" learner.

**Fix:** Add CallerAttribute, CallerModuleProgress, and Goal progress deletion to the reset transaction. Estimated effort: **30 minutes.**

---

## 9. Acceptance Criteria (Spec &sect;1.9)

| # | Criterion | Status | Gap? |
|---|---|---|---|
| 1 | Pipeline runs after every call, produces visible results | **Done** | Pipeline auto-triggers on call end; results visible in caller detail |
| 2 | Adaptation observable between sessions | **Done** | Prompt Navigator diff view |
| 3 | Mastery tracking shows progress across sessions | **Gap** | CallerModuleProgress data exists but not surfaced on Proof Points tab |
| 4 | No data loss | **Done** | Standard DB persistence |

**Gap on #3:** The Proof Points tab currently shows survey-based confidence lift metrics. Since Boaz has cut in-app surveys from Phase 1 (&sect;1.11), this tab will show "Awaiting survey completions." The pipeline mastery data (CallerModuleProgress) exists in the database but is not displayed.

**Fix:** Add a "Pipeline Mastery" section to the Proof Points tab showing CallerModuleProgress data alongside the existing survey section. Estimated effort: **2 hours.**

---

## 10. Scope Alignment (Spec &sect;1.11)

| Boaz says IN scope | Status |
|---|---|
| Course creation via wizard | **Done** |
| Onboarding mechanism | **Done** |
| Sim sessions with pipeline | **Done** |
| Prompt inspection | **Done** |
| Student reset | **Partial** (see &sect;8) |
| Stable test environment | **Ready** (needs deploy) |

| Boaz says OUT of scope | Our state | OK? |
|---|---|---|
| In-app surveys (L4-L7) | Proof Points tab references them | **Mismatch** — tab will be empty |
| Learners tab (A1-A6) | Built and working | Fine — useful for the testing loop |
| Proof Points dashboard (P1-P3) | Tab exists but survey-dependent | Needs pipeline mastery addition |
| VAPI voice calls | Not needed for Phase 1 | OK |
| WhatsApp gateway | Not needed for Phase 1 | OK |
| New database models | None added | OK |
| Schema migrations | None needed | OK |

---

## 11. Technical Blockers (Spec &sect;1.10)

All three blockers from Paul's original plan are resolved:

| Blocker | Status | Evidence |
|---|---|---|
| TODO #48 — `triggerPipeline` missing `mode: "prompt"` | **Fixed** | `webhook/route.ts:172` includes `mode: "prompt"` |
| TODO #49 — Goals not created on caller creation | **Fixed** | `callers/route.ts:268` calls `instantiatePlaybookGoals()` |
| TODO #50 — First call has no composed prompt | **Fixed** | `callers/route.ts:271` calls `autoComposeForCaller()` |

---

## 12. Verification Checklist (Spec &sect;1.12)

Pre-filled based on system analysis. Needs live verification on TEST env.

| # | Check | Expected Result | Needs Live Test |
|---|---|---|---|
| 1 | Create test course via wizard | Course appears, configured correctly | Yes |
| 2 | Click magic link, provide learner details | System picks up details | Yes |
| 3 | First sim session, AI greets, pipeline runs | Pipeline output visible in admin | Yes |
| 4 | Inspect composed prompt for session 2 | Shows adaptation from session 1 | Yes |
| 5 | Second sim session, AI reflects adapted prompt | Behaviour differs from session 1 | Yes |
| 6 | Inspect composed prompt for session 3 | Further adaptation visible | Yes |
| 7 | Repeat through all sessions | Mastery data accumulates | Yes |
| 8 | Reset learner, verify clean state, restart | Clean restart from onboarding | **Blocked** (Gap #1) |
| 9 | Partial completion, close browser, return, resume | Resumes from correct point | Yes |
| 10 | No data loss across all above | All data persists | Yes |

---

## Summary: 3 Gaps to Close

| # | Gap | Severity | Effort | Description |
|---|---|---|---|---|
| **1** | Reset incomplete | Medium | 30 min | Add CallerAttribute, CallerModuleProgress, and Goal progress to reset transaction |
| **2** | Mastery not visible | Medium | 2 hrs | Add pipeline mastery section to Proof Points tab (CallerModuleProgress data) |
| **3** | Deploy to TEST | Low | 1 hr | Deploy current codebase to `test.humanfirstfoundation.com` |

**Total remaining effort: ~3.5 hours**

Everything else — course creation, onboarding, sim sessions, pipeline, prompt inspection, pause/resume, environment separation — is built and ready.
