# IELTS Course-Docs Assembly — Handoff (2026-06-17)

**Branch:** `chore/ielts-course-docs-v2.3` (worktree `.claude/worktrees/agent-a5c4becc6b1f9b1fd`)
**Commits:** `ecf53da3` (band descriptors + scaffold pools), `ba46753e` (v2.3 course reference)
**Operator:** Paul Wander
**Goal:** Complete the IELTS Speaking Practice course-doc set so the wizard can build the course end-to-end from scratch.

---

## 1. Local-HDD inventory

Searched `~/Downloads`, `~/Documents`, `~/Desktop`, iCloud Drive, `~/Library/CloudStorage`, `~/Documents Local`, `~/hf_kb`, `~/spec-driven-staging`. No Dropbox or Google Drive sync folder on this Mac.

### Worktree state — pre-existing

| Path | Size | Content |
|---|---|---|
| `docs/external/ielts/ielts-speaking/Upload Docs/ielts-speaking-question-bank-part1.md` | (existing) | Part 1 question bank — operator-curated |
| `docs/external/ielts/ielts-speaking/Upload Docs/ielts-speaking-question-bank-part2.md` | (existing) | Part 2 cue card bank — operator-curated |
| `docs/external/ielts/ielts-speaking/Upload Docs/ielts-speaking-question-bank-part3.md` | (existing) | Part 3 theme library — operator-curated |
| `docs/external/ielts/ielts-speaking/Upload Docs/ielts-speaking-language-toolkit.md` | (existing) | HF toolkit — phrasebook for tutor reference |
| `docs/external/ielts/ielts-speaking/Upload Docs/assessor-rubric.md` | (existing) | Assessor rubric — operator-authored |
| `docs/external/ielts/ielts-speaking/Upload Docs/course-ref.md` | (existing) | Earlier course-ref iteration (pre-v2.x) |
| `docs/external/ielts/ielts-speaking/Upload Docs/tutor-briefing.md` | (existing) | HF tutor briefing |
| `docs/external/ielts/ielts-speaking/wizard-prompt.md` | (existing) | Wizard system prompt scaffold |

### Worktree gap — present on main, NOT yet on this worktree branch

The worktree was created off an older base than main. The main repo at `/Users/paulwander/projects/HF` carries the following additional files under `docs/external/ielts/` that this worktree does **not** carry:

| Path on main | Notes |
|---|---|
| `docs/external/ielts/ielts-speaking/cambridge-speaking-band-descriptors.pdf` | Public-version PDF on main |
| `docs/external/ielts/ielts-speaking/ielts-guide-for-teachers.pdf` | Cambridge teachers' guide |
| `docs/external/ielts/ielts-speaking/speaking-band-descriptors-cdn.pdf` | Joint-publisher band descriptors PDF |
| `docs/external/ielts/ielts-speaking/speaking-key-assessment-criteria.pdf` | Joint-publisher key-assessment-criteria PDF |
| `docs/external/ielts/ielts-speaking/speaking-sample-tasks-2023.pdf` | Sample tasks 2023 |
| `docs/external/ielts/ielts-listening/{ielts-guide-for-teachers,listening-sample-tasks-2023}.pdf` | Sibling exam materials |
| `docs/external/ielts/ielts-academic-reading/{ielts-guide-for-teachers,academic-reading-sample-tasks-2023,general-reading-sample-tasks-2023}.pdf` | Sibling exam materials |
| `docs/external/ielts/ielts-writing-task-2/{ielts-guide-for-teachers,writing-key-assessment-criteria,academic-writing-sample-tasks-2023,writing-band-descriptors-cdn}.pdf` | Sibling exam materials |

These are already on main and will land on the worktree when the branch is rebased/merged. No need to copy them into this branch.

### Outside the repo — local disk

| Path | Size | Likely content type | Notes |
|---|---|---|---|
| `~/Downloads/ielts-speaking v3/` (16 files, total ~7.0 MB) | folder | **Best-organised IELTS Speaking source set found.** Includes `ielts-speaking-key-assessment-criteria.md` (HF-authored markdown derived from the joint-publisher PDF — used as the basis for the band-descriptors-speaking-public.md created in this branch), `cambridge-speaking-band-descriptors.pdf`, `speaking-band-descriptors-cdn.pdf`, `speaking-key-assessment-criteria.pdf`, `ielts-guide-for-teachers.pdf`, plus markdown for cefr-mapping, question-types-guide, sample-responses-examiner-comments, test-format, sources index, question banks, language toolkit. **Recommendation:** the operator may want to move the markdown items here (cefr-mapping, question-types-guide, sample-responses-examiner-comments, test-format) into `docs/external/ielts/ielts-speaking/` in a future commit if they're meant to ship; they were not in scope for this task. PDFs duplicate what's already on main. |
| `~/Downloads/COURSE-REFERENCE-ielts-speaking-v2.2.md` | 127 KB | Standalone copy of v2.2 (matches fixture file) | Sourced from a Google Drive download. Same content as the v2.2 fixture in the repo. |
| `~/Downloads/drive-download-20260506T180051Z-3-001/COURSE-REFERENCE-ielts-speaking-v2.2.md` | 127 KB | Duplicate of the above | Same drive-download snapshot, different folder. |
| `~/Downloads/drive-download-20260506T180051Z-3-001/ielts-speaking-key-assessment-criteria.pdf` | 105 KB | **Joint-publisher PDF (British Council / IDP / Cambridge English).** Public Version. | Same PDF as `docs/external/ielts/ielts-speaking/speaking-key-assessment-criteria.pdf` on main. Public; no licensing concern. |
| `~/Downloads/drive-download-20260506T180051Z-3-001/Speaking-Band-descriptors.pdf` | 60 KB | Joint-publisher band descriptors PDF | Public Version; duplicate of on-main file. |
| `~/Downloads/COURSE-REFERENCE-ielts-speaking-band-6-to-7-5-v1.1-expanded.md` | 50 KB | Older v1.1 course reference — Eldar's version | Carried into v2.0 changelog. |
| `~/Downloads/ielts-v21-source.md` | 119 KB | Source-material dump from v2.1 era | Older draft material. |
| `~/Downloads/ielts-speaking-key-assessment-criteria.ashx.pdf` | 103 KB | Cambridge `.ashx` direct download of the public-version PDF | Public; identical content to other PDFs. |
| `~/Downloads/ielts-tutor-prototype.jsx` + `~/Downloads/ielts-tutor-prototype (1).jsx` | 47 KB each | JSX prototype | Out of scope for this task. |
| `~/Downloads/IELTS Speaking Product Behaviour Spec & BDD Stories.md` | 52 KB | Older BDD spec document | Out of scope. |
| `~/Downloads/HF-IELTS-Pre-Voice-Testing-Checklist.md` | 24 KB | Checklist for the epic #1700 work | Out of scope for this task — the user already has this. |
| `~/Downloads/Courses/ielts-writing-task2/` | empty | Empty folder | — |

No other IELTS material found in `~/Documents`, `~/Desktop`, iCloud Drive, `~/Library/CloudStorage`, or other top-level project folders.

### Licensing flags

**None.** No Cambridge IELTS 1–18 practice test books, no copyrighted exam books, no `cambridge-ielts-XX.pdf` or similar items found on disk. All PDFs encountered are the **Public Version** joint publications of the British Council / IDP IELTS / Cambridge English Assessment, distributed publicly at <https://www.ielts.org> and <https://www.cambridgeenglish.org>. No copyright-leakage risk.

If the operator later acquires the Examiner Version of the band descriptors (the licensed-to-certified-examiners document), keep it out of the repo per the IELTS partners' licence.

---

## 2. Files created (with absolute paths)

| Path | Bytes | Purpose |
|---|---|---|
| `/Users/paulwander/projects/HF/.claude/worktrees/agent-a5c4becc6b1f9b1fd/docs/external/ielts/ielts-speaking/band-descriptors-speaking-public.md` | ~10 KB | Public Version of the four scoring criteria (FC, LR, GRA, Pron), Bands 1–9. Used at projection time by the Skills Framework tier-mapping derivation. Sourced from the operator's existing `~/Downloads/ielts-speaking v3/ielts-speaking-key-assessment-criteria.md` (which is itself sourced from the joint-publisher PDF). |
| `/Users/paulwander/projects/HF/.claude/worktrees/agent-a5c4becc6b1f9b1fd/docs/external/ielts/ielts-speaking/stall-scaffolds-monologue.md` | ~3.4 KB | 14 short Part 2 monologue stall scaffolds, tagged early-stall / deep-stall / blank-out / bullet-stuck / explicit-stop. Operator content — not derived from any external source. |
| `/Users/paulwander/projects/HF/.claude/worktrees/agent-a5c4becc6b1f9b1fd/docs/external/ielts/ielts-speaking/stall-scaffolds-discussion.md` | ~4.0 KB | 15 short Part 3 discussion stall scaffolds, tagged i-dont-know / opinion-gap / abstraction-freeze / vocabulary-search / blank-out. Operator content. |
| `/Users/paulwander/projects/HF/.claude/worktrees/agent-a5c4becc6b1f9b1fd/apps/admin/lib/wizard/__tests__/fixtures/course-reference-ielts-v2.3.md` | ~135 KB | The v2.3 course reference (copy of v2.2 + the additions documented in §3). |
| `/Users/paulwander/projects/HF/.claude/worktrees/agent-a5c4becc6b1f9b1fd/docs/handoffs/2026-06-17-ielts-docs-assembly.md` | this file | Closeout handoff. |

---

## 3. v2.3 changelog (v2.2 → v2.3 deltas)

| Section | Change | Type |
|---|---|---|
| Header (line 5) | `Version: 2.2` → `Version: 2.3` | metadata |
| `## Course Configuration` | New `### Course shape` subsection — `courseStyle: structured`, `examShape: exam`, plus rationale prose | additive |
| `### Module 1 — Baseline Assessment` (after prose) | New `#### Module 1 — Baseline Assessment — Settings` subsection with YAML block | additive |
| `### Module 2 — Part 1: Familiar Topics` (after prose) | New `#### Module 2 — Part 1: Familiar Topics — Settings` subsection with YAML block | additive |
| `### Module 3 — Part 2: Cue Card Monologues` (after prose) | New `#### Module 3 — Part 2: Cue Card Monologues — Settings` subsection with YAML block | additive |
| `### Module 4 — Part 3: Abstract Discussion` (after prose) | New `#### Module 4 — Part 3: Abstract Discussion — Settings` subsection with YAML block | additive |
| `### Module 5 — Mock Exam` (after prose) | New `#### Module 5 — Mock Exam — Settings` subsection with YAML block | additive |
| `### Source 2 — Part 2 cue card bank` | Extended with `location` / `format` / `moduleRef` / `settingRef` rows | additive |
| `## Content Sources` (after Source 5) | New `### Source 6 — Part 2 stall scaffolds (monologue)` | additive |
| `## Content Sources` (after Source 6) | New `### Source 7 — Part 3 stall scaffolds (discussion)` | additive |
| `## Content Sources` (after Source 7) | New `### Source 8 — IELTS Speaking band descriptors (Public Version)` | additive |
| `## Document Version` footer | Version 2.2 → 2.3; last revised date → 17 June 2026; author line extended; new changelog entry | metadata |

**Net file growth:** v2.2 was 1061 lines; v2.3 is 1240 lines (additive only — no deletions). 5 module settings blocks + 3 new sources + course-shape declaration.

### Per-module settings values (derived from v2.2 prose, not fabricated)

| Field | baseline | part1 | part2 | part3 | mock |
|---|---|---|---|---|---|
| `minSpeakingSec` | 1200 | 600 | 120 | 420 | 1200 |
| `questionTarget` | 0/0 (examiner-scripted) | 5/8 | 1/1 | 4/5 | 0/0 (examiner-scripted) |
| `cueCardPool` | `source:cue-card-bank-baseline-v1` | `null` | `source:cue-card-bank-v1` | `null` | `source:mock-exam-scenario-pool-v1` |
| `topicPool` | — | `source:part1-topic-library-v1` | — | `source:part3-theme-library-v1` | — |
| `scheduledCues` | `[]` (warmer framing) | `[]` | `45s / 60s` | `[]` | `45s / 60s` |
| `scaffoldPool` | `source:stall-scaffolds-monologue` | `source:stall-scaffolds-discussion` | `source:stall-scaffolds-monologue` | `source:stall-scaffolds-discussion` | `source:stall-scaffolds-monologue` |
| `profileFieldsToCapture` | `[reason, targetBand, timeline, selfLevel]` | `[]` | `[]` | `[]` | `[]` |
| `prepSilenceSec` | 60 | 0 | 60 | 0 | 60 |
| `incompleteThresholdSec` | 600 (50% — relaxed warmer rule) | `null` (student-led) | 90 (below = retry-eligible) | `null` | 960 (80% — `mock_completion_threshold` 0.80 of 1200) |
| `scoringCriteria` | `[FC, LR, GRA, Pron]` | `[LR, GRA]` | `[FC, LR, GRA, Pron]` | `[LR, GRA]` | `[FC, LR, GRA, Pron]` |
| `scoreReadoutMode` | `on-screen` (warmer — no aloud) | `end-of-module-on-screen` | `end-of-module-on-screen` | `end-of-module-on-screen` | `aloud-with-indicative-qualifier` |

All values cross-checked against the v2.2 module prose + `## Configuration Variables`.

---

## 4. Items needing the user's licensing decision

**None.** No copyrighted material was found locally that the user might want to ship. All exam-content PDFs encountered are the publicly distributed joint-publisher versions. The Cambridge IELTS 1–18 practice test books were NOT found on disk — if the operator later acquires them they should be flagged at that point, not now.

---

## 5. TODOs flagged inside v2.3

**None.** Every field in every module settings block was derivable from the v2.2 prose plus `## Configuration Variables` plus the new course-shape declaration. No `# TODO: confirm` markers needed in the YAML blocks.

**One soft TODO from Task 3a** (band descriptors): three Pronunciation half-band descriptors (Bands 3, 5, 7) are intentionally relative in the Public Version ("Displays all the positive features of band X, and some, but not all, of the positive features of band Y"). The file flags each of these with `[verify against IELTS.org publication before wizard run]` so the projector can surface them as a warning rather than silently shipping unchecked text. If the operator has a current-edition Public Version PDF that gives a literal-paragraph alternative for those bands, swap it in before the first wizard run; otherwise the relative wording is canonical.

---

## 6. What is needed next

This branch ships the **course-docs** side. The remaining gap to wizard-end-to-end is the engineering side:

1. The wizard projector's `module-settings-yaml-block` recogniser (~30 LOC per `docs/draft-issues/journey-design-retirement-tabs.md` §"Gaps — additions needed to the IELTS course ref"). This needs to land in `apps/admin/lib/wizard/project-course-reference.ts` (or wherever `detectAuthoredModules` lives) so the v2.3 YAML blocks actually flow into `AuthoredModule.settings`.
2. The `appliesTo` field rollout in `JOURNEY_SETTINGS` + `VOICE_SETTINGS` (epic #1700 / journey-design-retirement-tabs).
3. The Modules tab UI (epic #1700 Phase 3).

When those land, point the wizard at `apps/admin/lib/wizard/__tests__/fixtures/course-reference-ielts-v2.3.md` for end-to-end IELTS course creation.

---

## Verified by

- Local-HDD inventory: live `find -iname` across `~/Downloads`, `~/Documents`, `~/Desktop`, iCloud Drive, `~/Library/CloudStorage`, `~/Documents Local`, `~/hf_kb`, `~/spec-driven-staging` (16 files in `~/Downloads/ielts-speaking v3/` enumerated by `stat -f`).
- Existing IELTS docs: `find docs/external/ielts -type f` against both the worktree and the main repo (`/Users/paulwander/projects/HF/docs/external/ielts/`).
- Band-descriptors sourcing: `Read` of `~/Downloads/ielts-speaking v3/ielts-speaking-key-assessment-criteria.md` (199 lines, citation-cited from `speaking-band-descriptors-cdn.pdf` + `speaking-key-assessment-criteria.pdf`).
- Gap doc: `Read` of `/Users/paulwander/projects/HF/docs/draft-issues/journey-design-retirement-tabs.md` §"Gaps — additions needed to the IELTS course ref" (lines 195–283).
- v2.3 structure: `wc -l` (1240 lines), `grep -c "^#### Module"` (5 module-settings blocks), `grep -c "^### Source"` (8 sources).
- All Lattice rules consulted: this task touches NO DB columns, no chain-stage boundaries, no new guards/contracts, no AI write/read paths, no cascade-eligible knobs. Lattice survey not required per `.claude/rules/lattice-survey.md` "When this applies".
