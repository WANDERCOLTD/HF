# Continue Here — TAM & GTM Doc Set

**Last touched:** 2026-06-04 by Paul + Claude
**Branch:** `chore/tam-docs-d1-d2`
**Status:** D1 + D2 shipped (V0.1). D3–D5 paused for review.

---

## What's done

| Code | Doc | Files | Status |
|---|---|---|---|
| D1 | Briefing Note | `D1-briefing-note.md` + `.pdf` | **Shipped V0.1** |
| D2 | Priority TAM Overview (Sector B + IELTS wedge) | `D2-priority-tam.md` + `.pdf` | **Shipped V0.1** |

Both follow the locked spine: 5-level nomenclature (Sector → Wedge → Channel → Account → Cohort), 4-question priority frame, TAM = Sector / SAM = Channel / SOM = Account, V/E/T confidence flags, and the 7-sector portfolio (A–G).

## What's locked (the spine — do not re-debate)

1. **Nomenclature:** 5 levels — Sector → Wedge → Channel → Account → Cohort
2. **Sizing map:** TAM = Sector | SAM = Channel | SOM = Account
3. **Confidence flags:** [V] verified · [E] estimate · [T] TBD
4. **Numbers:** always WW + UK; `-` where unknown
5. **Sector list:** 7 sectors A–G (B and G locked as P1)
6. **Phase-1 commitment:** Sector B / NMC speaking-band-7 wedge / IRA channel
7. **IELTS probe success criteria:** 3 hypotheses, all must pass
8. **SCQA (sharpened):** in D1 — do not re-edit
9. **Doc set:** D1–D7

## What's paused (resume in this order)

### Next: D4 — Citation Sheet (Google Sheet)

**Why next:** D1/D2 currently cite figures inline. Production-ready version needs every number to link back to a single citation sheet row.

**V0 schema (build first):**
| col | name | type | example |
|---|---|---|---|
| A | metric_id | text | `B.NMC.register_total` |
| B | sector | text | `B` |
| C | metric_name | text | NMC register total |
| D | value_ww | text | `–` |
| E | value_uk | text | 826k |
| F | unit | text | registrants |
| G | source_name | text | NMC Annual Register Report |
| H | source_url | url | https://www.nmc.org.uk/about-us/reports-and-accounts/registration-statistics/ |
| I | as_of_date | date | 2025-03 |
| J | confidence | enum | V / E / T |
| K | notes | text | – |

**Seed rows:** all rows from the "Top citations" table in D2 §11 + the verified-citation table I produced earlier in chat. ~60 rows.

### Next-next: D5 — Entity Lists (Google Sheet, multi-tab)

**Tabs:**
1. `IRAs` — 330 from NHS Employers Code-of-Practice list (top 8 named + tail)
2. `Healthcare regulators` — 9 UK statutory bodies
3. `Publishers` — 7 UK-HQ EFL publishers
4. `Pathway providers` — 7–9 UK pathway operators
5. `Test owners` — 5 (IELTS partners × 3, OET, PTE, Duolingo, TOEFL)
6. `CPD bodies` — ~30 UK CPD-mandated bodies (per D2 §3 cluster build-up)
7. `NHS Trusts (overseas-recruiting)` — top 30 by activity

Columns per row: name · type · website · primary_contact_role · linkedin · status (Pipeline/Active/Lapsed) · last_touch · owner

### After D4/D5: D3 — Full TAM & GTM Analysis (25–35pp)

Sections to write:
1. Executive summary (pyramid lift of D2)
2. Methodology & nomenclature (lift D7)
3. Each sector A–G — full deep-dive (replicate D2 §4 structure for each)
4. Channel taxonomy — comprehensive
5. The CPD meta-sector — body-by-body
6. IRA outreach plan — full version
7. The IELTS probe design — full
8. Phase 2 / 3 / 4 forward planning
9. Risk register — full
10. WW expansion thesis (US/EU/APAC follow-on)
11. Citation appendix (links to D4)
12. Entity appendix (links to D5)

### Other paused work (lower priority)

- **D6** — render the ASCII TAM picture as a designed slide (Google Slides or PowerPoint). Content is already in D1 + D2.
- **D7** — paste nomenclature standard into team wiki. Content is in D2 §2 + the chat conversation log.

## Outstanding research (the verification week, before any investor share)

Five ESTIMATEs to convert to VERIFIED:

| # | Estimate | How to verify | Effort |
|---|---|---|---|
| 1 | First-attempt healthcare-IELTS pass rate ~30–40% | Pull IELTS Partners disaggregated data by occupation; OET published band distribution | 2 days |
| 2 | Per-candidate English-prep spend £1–2.5k | 5–10 IRA exec interviews | 1 week |
| 3 | IRA market share Top-5 ~50% | Companies House revenue for all 330 IRAs + FOI'd top-30 NHS Trust IRA contracts | 1 week |
| 4 | OSCE-prep TAM £40–60M | NMC OSCE candidate × commercial OSCE-prep provider price points | 2 days |
| 5 | NHS overseas-nurse net spend ~£200M / yr (NAO is gross) | FOI NHSE Workforce Training & Education programme accounts | 2 weeks |

## Doc set roadmap

| Code | Doc | Status |
|---|---|---|
| D1 | Briefing Note (2pp) | ✅ Shipped V0.1 |
| D2 | Priority TAM Overview (~7pp) | ✅ Shipped V0.1 |
| D3 | Full TAM & GTM Analysis (25–35pp) | ⏸ Paused — drafted in chat, not in file |
| D4 | Citation Sheet (Google Sheet) | ⏸ Paused — schema ready |
| D5 | Entity Lists (Google Sheet) | ⏸ Paused — schema ready |
| D6 | TAM Picture (1-pager slide) | ⏸ ASCII shipped in D1/D2; render to slide pending |
| D7 | Nomenclature Standard (wiki) | ⏸ Embedded in D2 §2; wiki paste pending |

## How to resume

When Paul wants to pick this up:

```
git checkout chore/tam-docs-d1-d2
cat docs/strategy/CONTINUE-HERE.md
```

Then prompt: *"Resume the TAM doc set. Start with D4 (citation sheet schema + populated rows from D2 citations)."*

The chat history of this session has the source material for D3 and the full D4/D5 row content — anyone restarting should re-read it before drafting D3.

## Branch hygiene

This branch (`chore/tam-docs-d1-d2`) is doc-only. No code, no schema, no Prisma, no API. Safe to merge to main once D1+D2 are board-approved. After merge, open a new branch for D4/D5 work to keep concerns separated.
