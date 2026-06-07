---
title: "D4 — Citation Sheet"
subtitle: "Single source of truth for every figure in the HFF strategy set"
author: "Paul Wander"
date: "7 June 2026"
version: "0.1"
---

<style>
  @page {
    size: A4;
    margin: 22mm 20mm 22mm 20mm;
    @bottom-center {
      content: "Page " counter(page) " of " counter(pages);
      font-size: 8pt; color: #94a3b8;
      font-family: 'Helvetica Neue', Arial, sans-serif;
    }
    @bottom-left {
      content: "HFF Strategy — D4";
      font-size: 8pt; color: #94a3b8;
      font-family: 'Helvetica Neue', Arial, sans-serif;
    }
    @bottom-right {
      content: "Internal — Confidential";
      font-size: 8pt; color: #94a3b8;
      font-family: 'Helvetica Neue', Arial, sans-serif;
    }
  }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; line-height: 1.55; font-size: 11pt; }
  h1 { color: #0f172a; border-bottom: 3px solid #2563eb; padding-bottom: 8px; font-size: 22pt; margin-top: 0; }
  h2 { color: #1e3a5f; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-top: 24px; font-size: 14pt; page-break-after: avoid; }
  h3 { color: #334155; margin-top: 18px; font-size: 12pt; page-break-after: avoid; }
  h4 { color: #475569; margin-top: 14px; font-size: 11pt; page-break-after: avoid; }
  p { margin: 8px 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 9pt; page-break-inside: avoid; }
  th, td { border: 1px solid #e2e8f0; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; color: #0f172a; font-weight: 600; }
  code, pre { font-family: 'Menlo', monospace; font-size: 9pt; background: #f8fafc; }
  pre { padding: 10px; border-left: 3px solid #2563eb; page-break-inside: avoid; }
  blockquote { border-left: 3px solid #2563eb; padding-left: 12px; color: #334155; margin: 12px 0; }
  .meta { font-size: 9.5pt; color: #64748b; margin-top: -8px; margin-bottom: 16px; }
  .page-break { page-break-before: always; }
  .glossary { font-size: 9.5pt; }
  .glossary dt { font-weight: 600; color: #1e3a5f; }
  .glossary dd { margin: 0 0 4px 16px; }
  h2.section-break { page-break-before: always; }
  td.id { font-family: 'Menlo', monospace; font-size: 8.5pt; color: #1e3a5f; }
  td.conf { text-align: center; font-weight: 600; }
  td.conf-V { color: #15803d; }
  td.conf-E { color: #b45309; }
  td.conf-T { color: #b91c1c; }
</style>

::: meta
**Status:** Internal — Co-founders + Leadership   |   **Owner:** Paul Wander   |   **Reads with:** D1 (briefing), D2 (priority TAM), D8 (sales GTM plan), D5 (entity lists).
:::

## 1. Purpose

D4 is the **canonical citation sheet** behind every figure that appears in D1, D2, D3 and D8. One row per metric. Every figure cited inline in another HFF strategy doc must have a `metric_id` here.

The canonical store is the sister file `D4-citations.csv`. This document is the **printable read-through** of that file — same schema, same row order, designed for board / investor / advisor reading where the live sheet isn't appropriate.

## 2. Schema

| Column | Type | Example | Notes |
|---|---|---|---|
| `metric_id` | text | `B.NMC.register_total` | Stable key: `<sector>.<area>.<metric>`. Used as the cite anchor in other docs. |
| `sector` | text | `B` | One of A–G, or `–` for cross-sector tooling / operations. |
| `metric_name` | text | NMC register total | Human-readable label. |
| `value_ww` | text | `–` | Worldwide value where available; `–` where not yet built. |
| `value_uk` | text | 826 k | UK value. |
| `unit` | text | registrants | Unit applied to value (registrants / GBP / yr / %). |
| `source_name` | text | NMC Annual Register Report | Name of authoritative source. |
| `source_url` | url | https://www.nmc.org.uk/... | Canonical URL where possible. `–` = URL backlog (see §5). |
| `as_of_date` | date | 2025-03 | As-of period for the value. |
| `confidence` | enum | V / E / T | **V**erified · **E**stimate · **T**arget. |
| `notes` | text | – | Build method, verification ownership, or context. |

**Confidence flag conventions** (locked across the doc set):

- **V — Verified.** Number lifted from a named public source (regulator annual report, NAO, NHS Confederation, IELTS Partners). Stable; safe for external share.
- **E — Estimate.** HFF bottom-up build or industry consensus. Plausible, citable in internal docs, must be flagged in external decks.
- **T — Target.** Forecast / plan figure (e.g. Phase-1 ARR target, KPI dashboard week-52 numbers). Not a measurement.

<h2 class="section-break">3. Sector summary</h2>

Row counts and dominant confidence flag per sector, to orient the reader before the full table.

| Sector | Rows | Dominant conf | Notes |
|---|---|---|---|
| A. Adult Language Cert | 3 | V | WW IELTS sittings + WW prep market + UK TAM. Sector A is the IELTS probe surface. |
| **B. Health & Care Pro Registration** | **57** | **V on inputs, E on totals** | Phase-1 commit. Heavy citation density: 9 regulators × multiple metrics + IRA tier + economics + KPIs. |
| C. University-bound Journey | 2 | V | Portfolio-level only; deepens in D3. |
| D. Regulated Pro Exams | 2 | E | Portfolio-level only. |
| E. Corporate Compliance | 2 | V | Portfolio-level only. |
| F. K-12 Mainstream | 2 | V | Portfolio-level only. |
| G. CPD Meta-sector | 1 | E | Wide UK range £1.5–7.6 bn — tighten in D3 with body-by-body build. |
| meta (cross-sector tooling) | 3 | V | Sales tooling unit costs. |
| **Total** | **72** | – | |

<h2 class="section-break">4. Full citation table</h2>

Sorted by `metric_id`. Truncated columns shown — full URLs, notes, and as-of dates live in the CSV.

### Sector A — Adult Language Cert

| `metric_id` | Metric | UK | WW | Source | Conf |
|---|---|---|---|---|---|
| `A.IELTS.ww_sittings` | WW IELTS annual sittings | – | ~3.5 m | IELTS Partners Test Taker Performance Report | V |
| `A.market.ww_prep_total` | WW IELTS prep market | – | £2–3 bn | Grand View Research 2024 | V |
| `A.market.uk_tam` | UK Adult Language Cert TAM | £300–500 m | £2–3 bn | D2 portfolio table §3 | V/E |

### Sector B — Health & Care Pro Registration (TAM build)

| `metric_id` | Metric | UK | WW | Source | Conf |
|---|---|---|---|---|---|
| `B.market.uk_tam` | UK Sector B TAM (total horizon) | £180–290 m | – | D2 §4.4 bottom-up | E |
| `B.NMC.english_prep_tam` | NMC nurse English prep | £50–110 m | – | D2 §4.4 | E |
| `B.OSCE.prep_tam` | NMC OSCE clinical prep | £40–60 m | – | D2 §4.4 | E |
| `B.CBT.prep_tam` | NMC CBT knowledge prep | £10–20 m | – | D2 §4.4 | E |
| `B.HCPC.english_prep_tam` | HCPC AHP English prep | £6 m | – | D2 §4.4 | E |
| `B.GMC.plab_prep_tam` | GMC PLAB English + exam prep | £6 m | – | D2 §4.4 | E |
| `B.social_care.english_prep_tam` | Social-care-worker English prep | £18 m | – | D2 §4.4 | E |
| `B.adaptation.first_year_tam` | First-year adaptation / preceptorship | £50–75 m | – | D2 §4.4 | E |
| `B.NHS.overseas_nurse_recruitment_spend` | NHS overseas-nurse recruitment (cross-check) | ~£200 m | – | NAO Report 2023 | V |
| `B.NHS.cost_per_nurse_placement` | NHS cost per overseas placement | £10–15 k | – | NHS Confederation 2023 | V |

### Sector B — Regulator base figures

| `metric_id` | Metric | UK | Source | Conf |
|---|---|---|---|---|
| `B.NMC.register_total` | NMC register total | 826 k | NMC Annual Register Report Mar 2025 | V |
| `B.NMC.intl_joiners` | NMC international joiners / yr | 22–26 k | NMC Annual + Quarterly Reports | V |
| `B.GMC.register_total` | GMC register total | 334 k | GMC SoMEP 2024 | V |
| `B.GMC.intl_joiners` | GMC international joiners / yr | 14–16 k | GMC SoMEP 2024 | V |
| `B.GMC.plab_candidates` | GMC PLAB cohort / yr | ~3 k | GMC SoMEP 2024 | V |
| `B.HCPC.register_total` | HCPC register total | 340 k | HCPC Annual Report 2024 | V |
| `B.HCPC.intl_joiners` | HCPC international joiners / yr | 5–7 k | HCPC Annual Stats 2024 | V |
| `B.GPhC.register_total` | GPhC register total | 70 k | GPhC Annual Report 2024 | V |
| `B.GPhC.intl_joiners` | GPhC international joiners / yr | 1–2 k | GPhC Annual Report 2024 | V |
| `B.GDC.register_total` | GDC register total | 120 k | GDC Annual Report 2024 | V |
| `B.GDC.intl_joiners` | GDC international joiners / yr | 1–2 k | GDC Annual Report 2024 | V |
| `B.SWE.register_total` | SWE register total | 100 k | SWE Annual Report 2024 | V |
| `B.SWE.intl_joiners` | SWE international joiners / yr | 2–4 k | SWE Annual Report 2024 | V |
| `B.smaller_regulators.register_total` | GOC + GOsC + GCC combined | ~40 k | Body annual reports | V |
| `B.regulators.total_register` | All 9 Sector B regulators combined | ~1.83 m | D2 §4.2 rollup | V |
| `B.regulators.total_intl_joiners` | All Sector B intl joiners / yr | ~50–60 k | D2 §4.2 rollup | V |
| `B.OSCE.annual_candidates` | NMC OSCE candidates / yr | ~25 k | NMC OSCE statistics | V |
| `B.IRA.list_size` | IRAs on NHS Employers Code-of-Practice list | ~330 | NHS Employers Code of Practice | V |
| `B.WHO.red_list_countries` | WHO Red List source countries | 55 | WHO Health Workforce Support and Safeguards List | V |
| `B.NHS.trust_count` | NHS Trusts (direct-recruiting) | 217 | D2 §6.4 + D8 §3.4 | V |

### Sector B — IRA economics and Phase-1 commercials

| `metric_id` | Metric | UK | Source | Conf |
|---|---|---|---|---|
| `B.IRA.cost_per_failed_candidate` | IRA cost per failed IELTS candidate | ~£12 k | NHS Confederation unit costs | V |
| `B.IRA.top5_share` | Top-5 IRA share of UK overseas-nurse flow | ~50 % | Industry consensus (FOI to verify) | E |
| `B.pilot.price_flat` | Standard pilot price | £15 k | D2 §5.4 + §7.2 | V |
| `B.pilot.cohort_size` | Standard pilot cohort | 50 | D2 §7.2 | V |
| `B.pilot.duration_weeks` | Standard pilot duration | 8 wk | D2 §7.2 | V |
| `B.contract.arpu_per_candidate` | Annual ARPU per candidate | £600–900 | D2 §5.4 + D8 §9 | V |
| `B.contract.annual_per_ira` | Annual contract per IRA | £200–300 k | D2 §5.4 | E |
| `B.contract.arpu_blended` | Blended ARPU per candidate (Phase 1) | £600–900 | D2 §5.4 | E |
| `B.candidate.english_prep_spend` | Per-candidate English-prep spend | £1,000–2,500 | Bottom-up | E |
| `B.IELTS.first_attempt_pass_rate` | Healthcare first-attempt IELTS-7.0 pass | 30–40 % | IELTS Partners + OET dist. | E |

### Sector B — Tier-1 IRA likely ARR (D8 §3)

| `metric_id` | Account | UK | Source | Conf |
|---|---|---|---|---|
| `B.IRA.yourworld.likely_arr` | Yourworld Healthcare | £200–300 k | NHS Employers List | E |
| `B.IRA.hcl.likely_arr` | HCL Workforce Solutions | £200–300 k | NHS Employers List | E |
| `B.IRA.sanctuary.likely_arr` | Sanctuary Personnel | £150–250 k | NHS Employers List | E |
| `B.IRA.greenstaff.likely_arr` | Greenstaff Medical | £150–250 k | NHS Employers List | E |
| `B.IRA.globe_locums.likely_arr` | Globe Locums | £100–200 k | NHS Employers List | E |

### Sector B — Conversion economics (D2 §6.3)

| `metric_id` | Metric | UK | Source | Conf |
|---|---|---|---|---|
| `B.outbound.cold_response_rate` | Cold outbound → response | 15 % | D2 §6.3 | E |
| `B.outbound.warm_intro_rate` | Warm-intro → response | 50 % | D2 §6.3 | E |
| `B.outbound.response_to_discovery` | Response → discovery call | 80 % | D2 §6.3 | E |
| `B.outbound.discovery_to_scoping` | Discovery → pilot scoping | 50 % | D2 §6.3 | E |
| `B.outbound.scoping_to_signed` | Scoping → signed pilot | 60 % | D2 §6.3 | E |
| `B.outbound.pilot_to_paid` | Pilot → paid annual | 60 % | D2 §6.3 | E |

### Sector B — Phase-1 targets (D8 §10)

| `metric_id` | Metric | UK | Source | Conf |
|---|---|---|---|---|
| `B.phase1.arr_target` | Phase-1 ARR target | £500 k – £1.2 m | D2 §6.3 + D8 §1 | T |
| `B.phase1.som_3yr` | 3-year SOM target | £8–20 m | D2 §1 + D8 §1 | T |
| `B.phase1.touches_w52` | Outbound touches (W52) | 300 | D8 §10 | T |
| `B.phase1.discovery_w52` | Discovery calls (W52) | 60 | D8 §10 | T |
| `B.phase1.pilots_signed_w52` | Pilots signed (W52) | 8 | D8 §10 | T |
| `B.phase1.pilots_paid_w52` | Pilots paid (W52) | 5 | D8 §10 | T |

### Sectors C–G + meta

| `metric_id` | Metric | UK | WW | Source | Conf |
|---|---|---|---|---|---|
| `C.market.uk_tam` | UK University-bound Journey TAM | £400–600 m | – | D2 §3 | V |
| `C.market.ww_he_intl_student_spend` | WW HE intl student spend (cross-check) | – | $30–50 bn | D2 §3 | V |
| `D.market.uk_tam` | UK Regulated Pro Exams TAM | ~£500 m | – | D2 §3 | E |
| `D.market.ww_tam` | WW Regulated Pro Exams TAM | – | $5–8 bn | D2 §3 | E |
| `E.market.uk_tam` | UK Corporate Compliance TAM | £2–4 bn | – | D2 §3 | V |
| `E.market.ww_tam` | WW Corporate Compliance TAM | – | $30–40 bn | D2 §3 | V |
| `F.market.uk_tam` | UK K-12 Mainstream TAM | £1.5 bn | – | D2 §3 | V |
| `F.market.ww_tam` | WW K-12 Mainstream TAM | – | $20 bn+ | D2 §3 | V |
| `G.market.uk_tam` | UK CPD Meta-sector TAM | £1.5–7.6 bn | – | D2 §3 | E |
| `meta.tooling.sales_nav_monthly` | LinkedIn Sales Navigator | £90 / mo | – | D8 §11 | V |
| `meta.tooling.crm_monthly` | HubSpot / Pipedrive | £50 / mo | – | D8 §11 | V |
| `meta.tooling.loom_monthly` | Loom | £10 / mo | – | D8 §11 | V |

<h2 class="section-break">5. Verification targets — the 5 to flip from E → V</h2>

Lifted from D2 §11 and held here as the canonical verification backlog. **Cleared before any investor share.**

| # | `metric_id` | Estimate | How to verify | Effort | Owner |
|---|---|---|---|---|---|
| 1 | `B.IELTS.first_attempt_pass_rate` | 30–40 % | Pull IELTS Partners disaggregated data by occupation; OET published band distribution | 2 days | TBD |
| 2 | `B.candidate.english_prep_spend` | £1,000–2,500 | 5–10 IRA exec interviews | 1 week | TBD |
| 3 | `B.IRA.top5_share` | ~50 % | Companies House revenue for all 330 IRAs + FOI'd top-30 NHS Trust IRA contracts | 1 week | TBD |
| 4 | `B.OSCE.tam_verify` | £40–60 m | NMC OSCE candidate count × commercial OSCE-prep provider price points | 2 days | TBD |
| 5 | `B.NHS.overseas_nurse_net_spend` | ~£200 m / yr | FOI NHSE Workforce, Training & Education programme accounts (NAO figure is gross) | 2 weeks | TBD |

## 6. URL backlog

Rows with `source_url = –` need a canonical URL added before D4 ships V0.2. Audit before next investor read.

| `metric_id` | Why blank | Fix |
|---|---|---|
| `A.market.ww_prep_total` | Grand View Research source held in HFF Drive PDF | Add the GVR public landing page (or replace with a free-access source) |
| All `A.market.uk_tam`, sectors C–G portfolio rows | Sourced from D2 §3 portfolio table, not an external doc | Either link the D2 anchor or add the underlying study URL when D3 deep-dives are written |
| All `B.*.prep_tam` rows | HFF bottom-up build — no single external source | Link each to the cell-by-cell build worksheet (to be written) |
| `B.smaller_regulators.register_total` | Combined GOC + GOsC + GCC | Add the 3 individual body URLs (annual reports) |
| `B.IRA.top5_share`, `B.candidate.english_prep_spend` | Industry consensus / bottom-up; no public source today | Will be backed by FOI + IRA interviews during verification window |
| `B.IRA.*.likely_arr` (5 Tier-1 rows) | HFF internal estimate | No external URL planned — flag remains E |
| `B.contract.*`, `B.pilot.*` | HFF commercial standard | No external URL planned — flag remains V |
| `B.outbound.*` | HFF conversion-economics assumption | Re-flag as V (with notes) after first 3 IRA cycles measured |
| `B.phase1.*` | Plan targets, not measurements | Flag remains T until matched against actuals |

## 7. How to regenerate the PDF

From the strategy directory:

```bash
cd docs/strategy
pandoc D4-citations.md -o D4-citations.pdf --pdf-engine=weasyprint --standalone
```

To re-import the CSV into Sheets: File → Import → `D4-citations.csv` → Replace current sheet.

<div class="page-break"></div>

## Appendix A — Doc index

| Code | Title | Status |
|---|---|---|
| D1 | Briefing Note | Shipped V0.2 |
| D2 | Priority TAM Overview | Shipped V0.2 |
| D3 | Full TAM & GTM Analysis | Paused |
| **D4** | **Citation Sheet (this doc + CSV)** | **Shipped V0.1** |
| D5 | Entity Lists | Paused |
| D6 | TAM Picture | Embedded in D1 / D2 |
| D7 | Nomenclature Standard | Embedded in D2 §2 |
| D8 | Sales GTM Plan — Phase-1 Slice | Shipped V0.1 |

<div class="page-break"></div>

## Glossary

<dl class="glossary">
<dt>AHP</dt><dd>Allied Health Professional</dd>
<dt>ARPU</dt><dd>Average Revenue Per User</dd>
<dt>ARR</dt><dd>Annual Recurring Revenue</dd>
<dt>BD</dt><dd>Business Development</dd>
<dt>CBT</dt><dd>Computer-Based Test (NMC knowledge test taken before OSCE)</dd>
<dt>Confed</dt><dd>NHS Confederation</dd>
<dt>CPD</dt><dd>Continuing Professional Development</dd>
<dt>CRM</dt><dd>Customer Relationship Management</dd>
<dt>D1 – D8</dt><dd>HFF strategy document codes (see Appendix A)</dd>
<dt>E</dt><dd>Estimate (confidence flag — HFF bottom-up or industry consensus)</dd>
<dt>FOI</dt><dd>Freedom of Information request</dd>
<dt>FT</dt><dd>NHS Foundation Trust</dd>
<dt>GCC</dt><dd>General Chiropractic Council</dd>
<dt>GDC</dt><dd>General Dental Council</dd>
<dt>GMC</dt><dd>General Medical Council</dd>
<dt>GOC</dt><dd>General Optical Council</dd>
<dt>GOsC</dt><dd>General Osteopathic Council</dd>
<dt>GPhC</dt><dd>General Pharmaceutical Council</dd>
<dt>HCPC</dt><dd>Health and Care Professions Council</dd>
<dt>HE</dt><dd>Higher Education</dd>
<dt>HFF</dt><dd>Human First Foundation</dd>
<dt>IELTS</dt><dd>International English Language Testing System</dd>
<dt>IRA</dt><dd>International Recruitment Agency</dd>
<dt>KPI</dt><dd>Key Performance Indicator</dd>
<dt>NAO</dt><dd>National Audit Office</dd>
<dt>NHS</dt><dd>National Health Service</dd>
<dt>NHSE</dt><dd>NHS England</dd>
<dt>NMC</dt><dd>Nursing and Midwifery Council</dd>
<dt>OET</dt><dd>Occupational English Test</dd>
<dt>OSCE</dt><dd>Objective Structured Clinical Examination</dd>
<dt>P0 – P5</dt><dd>HFF Priority codes (P0 = active probe; P1 = commit; P5 = deprioritise)</dd>
<dt>pp</dt><dd>Percentage points</dd>
<dt>PLAB</dt><dd>Professional and Linguistic Assessments Board</dd>
<dt>SAM</dt><dd>Serviceable Addressable Market</dd>
<dt>Sector A – G</dt><dd>HFF Sector codes (A = Adult Language Cert; B = Health &amp; Care Pro Registration; C = University-Bound Journey; D = Regulated Pro Exams one-shot; E = Corporate Compliance Training; F = K-12 Mainstream; G = CPD Meta-sector)</dd>
<dt>SOM</dt><dd>Serviceable Obtainable Market</dd>
<dt>SoMEP</dt><dd>State of Medical Education and Practice (GMC annual report)</dd>
<dt>SWE</dt><dd>Social Work England</dd>
<dt>T</dt><dd>Target (confidence flag — forecast / plan figure, not a measurement)</dd>
<dt>TAM</dt><dd>Total Addressable Market</dd>
<dt>Tier 1 / 2 / 3</dt><dd>D8 account-prioritisation tiers</dd>
<dt>UK / WW</dt><dd>United Kingdom / Worldwide</dd>
<dt>V</dt><dd>Verified (confidence flag — figure from a named public source)</dd>
<dt>V / E / T</dt><dd>Confidence flags — Verified / Estimate / Target</dd>
<dt>W52</dt><dd>Week 52 (end of Phase 1)</dd>
<dt>WHO</dt><dd>World Health Organization</dd>
</dl>
