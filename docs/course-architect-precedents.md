# Course Architect — Precedent Catalogue

> Growable catalogue of topics audited against HFF suitability. The `course-architect` agent reads this on every invocation and reasons by analogy.
>
> **Adding a precedent:** include all 8 sections below. Update via PR — this file is system knowledge.

---

## How to read an entry

| Field | Meaning |
|---|---|
| **Trust level** | The highest `ContentTrustLevel` (`prisma/schema.prisma:30`) the topic's strongest published source reaches. |
| **Teaching profile** | The `TeachingProfileKey` (`apps/admin/lib/content-trust/teaching-profiles.ts`) that best fits, before overrides. |
| **Structure match** | Native / Partial / Mismatch — does the published academic structure match the audience-led use case? |
| **Audience fits** | Audiences this topic works for (and ones it doesn't). |
| **Failure-mode flags** | Sweep result against the Step 7 catalogue in `course-architect.md`. |
| **Demo wow line** | The single moment in the call arc where the platform's value lands. |

---

## Big Five (OCEAN) Personality — **STRONG GO**

- **Trust level:** `PUBLISHED_REFERENCE` (L3) at minimum; the BFI-2 paper (Soto & John 2017, *JPSP*) is peer-reviewed; the John & Srivastava chapter is the canonical *Handbook of Personality* reference.
- **Teaching profile:** `recall-led` for the trait/facet naming layer; `discussion-led` overrides for the "what does this trait *mean* in real life" depth layer. Combine via `teachingOverrides`.
- **Primary sources:**
  - John & Srivastava (1999) — *"The Big Five Trait Taxonomy: History, Measurement, and Theoretical Perspectives"* in *Handbook of Personality: Theory and Research* (2e), ch. 4. **Spine.**
  - Soto & John (2017) — *"The next Big Five Inventory (BFI-2)"* (*JPSP*). 5 domains × 3 facets — the LO seed shape.
  - Costa & McCrae (1992) — *NEO-PI-R Professional Manual*. Alternative 6-facet structure.
  - McCrae & Costa (1997) — *"Personality trait structure as a human universal"* (*American Psychologist*). Cross-cultural validity.
  - OpenStax Psychology 2e, ch. 11. Plain-English framing; public-domain Content Authority excerpt.
- **Structure match:** **Native.** 5 traits both academically and in audience interest. No translation tax.
- **Audience fits:** Non-AI startup adult ✅; HR/L&D ✅; coaching context ✅. Less fit for compliance audiences (no qualification ref).
- **Failure-mode flags:**
  - LO count: 5 domains × 3 facets = 15 LOs + 1 meta = **16** → passes the EMA-visibility check
  - Voice-native: ✅ no diagrams required
  - Misconception density: high ("introvert = shy", "neurotic = neurotic", "agreeable = nice")
  - Pop-folklore creep: low — Big Five is academia's own taxonomy, not retrofitted from folk usage
- **Demo wow line:** **Call 3** — "Last time you described yourself as introverted, but the items you scored highest on were *low Sociability* + *high Assertiveness*. Those go in different directions in BFI-2 — let's pull them apart."

---

## Attachment Theory — **STRONG GO**

- **Trust level:** `PUBLISHED_REFERENCE` (L3). Bowlby + Ainsworth foundational, Mikulincer & Shaver textbook canonical.
- **Teaching profile:** `discussion-led`. Topic is reflective, not factual recall. Override `deliveryHints` to include "open scenarios from the learner's own life" rather than abstract case vignettes.
- **Primary sources:**
  - Bowlby (1969/1973/1980) — *Attachment* trilogy. Theoretical foundation.
  - Ainsworth, Blehar, Waters & Wall (1978) — *Patterns of Attachment*. Strange Situation, 4 styles.
  - Hazan & Shaver (1987) — *"Romantic love conceptualized as an attachment process"* (*JPSP*). Adult attachment extension.
  - Mikulincer & Shaver (2016) — *Attachment in Adulthood* (2e). Canonical adult-attachment textbook.
- **Structure match:** **Native.** 4 styles (Secure / Anxious / Avoidant / Disorganized) match how audiences want to think about it.
- **Audience fits:** Non-AI startup adult ✅; relationships/dating context ✅; therapy-adjacent ✅. Less fit for B2B compliance.
- **Failure-mode flags:**
  - LO count: 4 styles × ~3 facets (formation, behaviour, romantic extension) + 2 meta = **~14** → passes EMA-visibility check
  - Voice-native: ✅
  - Misconception density: **very high** — people self-diagnose wildly, perfect catch-and-correct surface
  - Cross-cultural validity: **flag** — attachment styles shift in collectivist cultures (Rothbaum et al. 2000). Either scope to Western context or add a cross-cultural module.
  - Pop-folklore creep: **medium** — Instagram-therapy taxonomies exist; the academic Bowlby-Ainsworth lineage is rock-solid but learners arrive with folk versions.
- **Demo wow line:** **Call 2** — "Last call you described your reaction to your partner's coldness as *anxious*. Walk me through what Mary Ainsworth's Strange Situation predicts a secure response would look like."

---

## Seducing Strangers (Persuasion & Sales) — **STRONG GO (with conditions)**

- **Trust level:** `PUBLISHED_REFERENCE` (L3) via compound sourcing. Single-book Weltman alone would be `EXPERT_CURATED` (L2). The compound strategy (Cialdini spine + Weltman voice + Heath application + ELM/Prospect Theory) gets the course to L3.
- **Teaching profile:** `recall-led` for principle naming + `discussion-led` overrides in Teaching Approach text for the ethics/misuse layer. Override `deliveryHints` to include "every module ends with the misuse pattern for that principle" and "use the learner's own recent purchase / pitch / ad as the example".
- **Primary sources:**
  - Cialdini, R. B. (2021) — *Influence: The Psychology of Persuasion* (New & Expanded). Harper Business. **Spine** (7 principles).
  - Weltman, J. (2015) — *Seducing Strangers*. Workman Publishing. Voice + examples; not authority.
  - Heath, C. & Heath, D. (2007) — *Made to Stick*. Random House. Application framework (SUCCESS).
  - Petty, R. E. & Cacioppo, J. T. (1986) — ELM. Springer. Cognitive frame.
  - Kahneman, D. & Tversky, A. (1979) — Prospect Theory (Econometrica). Loss / scarcity asymmetry.
  - Cialdini, R. B. et al. (2006) — Managing social norms for persuasive impact (Social Influence). Social-proof boomerang case.
- **Structure match:** **Partial.** Cialdini's seven principles map to the audience's "how do I sell better / spot persuasion?" demand. Translation tax is tone — academic Cialdini reads dry; Weltman's voice supplies the practitioner energy. Solve in Teaching Approach text, not in module structure.
- **Audience fits:** Non-AI startup adult ✅ (high relevance — everyone gets sold to); founder / marketer / sales context ✅; B2B procurement / engineering audience moderate (peripheral cues weaken; the course teaches the audience-side recognition either way).
- **Failure-mode flags:**
  - LO count: 5 modules × ~3 LOs = **16** → passes EMA visibility
  - Voice-native: ✅
  - Misconception density: **very high** — every principle has documented misuses; perfect catch-and-correct surface
  - Pop-folklore creep: **flag** — TikTok / Substack marketing-influencer content is everywhere. Strategy: name them as misconception material, not as competitors to the academic spine.
  - Cross-cultural validity: **flag** — Cialdini's principles replicate cross-culturally but Authority + Reciprocity timing + Unity calibrate by Hofstede dimensions. Include cross-cultural LO in Module 4.
  - **🆕 Dual-use risk: HIGH.** *First precedent in catalogue to surface this failure mode.* This topic teaches mechanisms that work whether or not the deployer is honest. Mitigation: ethics LO threaded through every module's Edge Cases — present from Module 1, not bolted on at the end.
- **Conditions** (mandatory, not optional):
  - Ethics LO (`pers.ethics_dual_use`) in Module 1, not deferred.
  - Every principle module's Edge Cases names the misuse pattern for that principle.
  - Course Reference explicitly states: "Cialdini's seven principles describe mechanisms that work whether or not the deployer is honest — this course teaches recognition of misuse alongside use."
  - Truth-test taught operationally: "Would the audience still be persuaded if they could see exactly what was being done and why?"
- **Demo wow line:** **Call 3** — "Last call you said you bought something because of a countdown timer. Close the tab on that site right now in another window and check — is the timer still going? When it resets, that's not scarcity, that's a credibility loan they took out at your expense. Cialdini calls this the most credibility-fragile of the seven principles for exactly this reason."

---

## Sleep Science — **GO**

- **Trust level:** `REGULATORY_STANDARD` (L5) for the AASM clinical practice guidelines; `PUBLISHED_REFERENCE` (L3) for the textbook layer.
- **Teaching profile:** `recall-led` with `practice-led` overrides for behavioural/hygiene LOs. Custom `deliveryHints` for the "diagnose your own sleep" application phase.
- **Primary sources:**
  - AASM Clinical Practice Guidelines — multiple, by topic (Insomnia 2017, OSA 2019, etc.).
  - Kryger, Roth & Dement (eds.) — *Principles and Practice of Sleep Medicine* (7e, 2021). The field's standard textbook.
  - Carskadon & Dement chapter in the above — normal sleep architecture (NREM/REM, stages).
  - NIH NHLBI sleep resources (consumer-grade Content Authority excerpts).
- **Structure match:** **Native** for "sleep architecture → circadian → hygiene → disorders". Audience-led demand maps cleanly.
- **Audience fits:** Non-AI startup adult ✅; healthcare staff ✅; performance/biohacker ✅.
- **Failure-mode flags:**
  - LO count: 4 modules × ~4 LOs = **~16** → passes
  - Voice-native: ✅
  - Misconception density: **very high** — the 8-hour myth, alcohol-as-sleep-aid, naps, blue light, melatonin dose. Perfect catch-and-correct.
  - Pop-folklore creep: **flag** — Matthew Walker's book has had several claims publicly contested. Cite AASM + textbook, not Walker.
- **Demo wow line:** **Call 3** — "Last call you said you drink wine to fall asleep. The AASM guidelines have something specific to say about that — guess what happens to your REM after alcohol."

---

## Dark Triad of Personality — **CONDITIONAL GO**

- **Trust level:** `PUBLISHED_REFERENCE` (L3). Founding paper + validated measurement instrument.
- **Teaching profile:** `recall-led` for the naming layer; `discussion-led` for the discrimination-between-traits layer. Combine.
- **Primary sources:**
  - Paulhus & Williams (2002) — *"The Dark Triad of personality"* (*JRP*). **Founding paper.**
  - Jones & Paulhus (2014) — *"Introducing the Short Dark Triad (SD3)"* (*Assessment*). 27 items, 9 per trait — the LO seed.
  - Christie & Geis (1970) — *Studies in Machiavellianism* (MACH-IV). Original Mach instrument.
  - Pincus & Lukowitsky (2010) — *"Pathological narcissism and narcissistic personality disorder"* (*Annual Review of Clinical Psychology*). Grandiose / Vulnerable split.
  - Hare's PCL-R + Patrick's TriPM — two competing psychopathy structures; pick one or teach the contrast.
- **Structure match:** **Partial.** Sources give 3 distinct traits; audience-led demand is "which trait is my boss?" — needs discrimination LOs (trait X ≠ syndrome Y) bridged in.
- **Audience fits:** Non-AI startup adult ✅ (dinner-party currency very high); leadership/HR ✅ (with care). Avoid for clinical training — these are subclinical traits, not DSM diagnoses.
- **Failure-mode flags:**
  - LO count: 3 traits × ~4 facets + 1 meta + 3 discrimination LOs = **~16** → passes
  - Voice-native: ✅
  - Misconception density: **extreme** — people conflate the three traits, conflate trait with disorder, conflate empathy gap with psychopathy. Catch-and-correct paradise.
  - Pop-folklore creep: **flag** — true-crime / pop-psych content is everywhere. Cite Paulhus & Williams, not podcasts.
  - "Diagnosis" risk: **flag** — must teach trait independence (one trait ≠ syndrome) as its own LO or the course produces armchair-diagnosis behaviour.
- **Conditions:** Add explicit discrimination LOs (Trait X alone ≠ Syndrome Y) — see Big Five precedent for the same pattern.
- **Demo wow line:** **Call 3** — "Last call you described your boss as a psychopath because of the empathy thing — let's pressure-test that. Could it just be the Mirror trait? Walk me through the difference between cognitive and affective empathy."

---

## Cognitive Biases — **CONDITIONAL GO (translation tax)**

- **Trust level:** `PUBLISHED_REFERENCE` (L3) for the academic structure; **`UNVERIFIED` (L0)** for popular taxonomies (Buster Benson MAIN, Cognitive Bias Codex).
- **Teaching profile:** `discussion-led` for the academic mechanism layer; `recall-led` only as supporting study aid.
- **Primary sources:**
  - Tversky & Kahneman (1974) — *"Judgment under uncertainty: Heuristics and biases"* (*Science*). Foundational.
  - Gilovich, Griffin & Kahneman (eds., 2002) — *Heuristics and Biases: The Psychology of Intuitive Judgment*. **The standard graduate text.**
  - Kahneman (2011) — *Thinking, Fast and Slow*. System 1 / System 2 framing.
  - Kahneman & Tversky (1979) — *"Prospect Theory"* (*Econometrica*). Loss aversion + framing.
- **Structure match:** **Mismatch.** Academic structure groups by *mechanism* (Representativeness, Availability, Anchoring); audience demand is an *exemplar list* (FAE, halo, sunk cost). Translation tax is non-trivial.
- **Audience fits:** Non-AI startup adult ✅ (but only after translation); academic/behavioural-econ students ✅ (native).
- **Failure-mode flags:**
  - Pop-folklore creep: **severe** — MAIN, Cognitive Bias Codex, "list of 200 biases" are all `UNVERIFIED` (L0). Decline to use them as structural spine.
  - LO count: **depends on packing** — risk of either too few (5 mechanisms) or too many (50 named biases). Tune to ~15 by selecting an exemplar from each mechanism family.
  - Voice-native: ✅
  - Misconception density: medium — each bias has near-cousins (recency vs availability, FAE vs halo) — good catch-and-correct surface once translated.
- **Conditions:** **Either** (a) accept the academic mechanism structure as the spine and frame exemplars as "evidence of the mechanism," **or** (b) reframe audience-purpose to "exemplar-spotter at dinner parties" and accept L1/L2 source quality on the structural mnemonic layer.
- **Demo wow line:** **Call 3** — "Last call you flagged your colleague's behaviour as Confirmation Bias. The 1974 Tversky-Kahneman framing would call that an Availability move — let's pull them apart."

---

## Plate Tectonics — **NO-GO for voice-only demo**

- **Trust level:** `PUBLISHED_REFERENCE` (L3) — university geology textbooks, USGS.
- **Teaching profile:** `recall-led` nominally; **but breaks the voice-native test.**
- **Primary sources:**
  - Marshak — *Earth: Portrait of a Planet*. Standard undergraduate textbook.
  - USGS plate tectonics primer (public-domain Content Authority).
- **Structure match:** **Native** structurally (plates → boundary types → mechanism → evidence) — but the structural fit doesn't survive the voice constraint.
- **Audience fits:** Educator audiences ✅ (with screen); ❌ for non-AI adult demo in voice-only context.
- **Failure-mode flags:**
  - **Voice/visual mismatch — BLOCKING.** Subduction zones, ridges, fault types are diagrams. Spoken descriptions ("the Pacific plate slides under the North American plate") are *harder than they sound* and produce thin tutor moments.
  - LO count: ~10-12 → marginal on EMA visibility
  - Demo audience tune-out: Year 9 geography energy for adult demo audience.
- **Demo wow line:** **None reliably lands** in voice-only. The "I understand earthquakes now" outcome requires diagram support that VAPI cannot deliver.

**Reject for the non-AI adult demo. Acceptable for educator audiences with screen support.**

---

## Music Theory Fundamentals — **CONDITIONAL GO (audience filter)**

- **Trust level:** `ACCREDITED_MATERIAL` (L4) for conservatory curricula; `PUBLISHED_REFERENCE` (L3) for the standard textbook.
- **Teaching profile:** `practice-led` — worked-example shape suits intervals/chord construction.
- **Primary sources:**
  - Kostka, Payne & Almén — *Tonal Harmony* (8e). Standard college textbook.
  - Walter Piston — *Harmony* (5e). Classical reference.
  - Conservatory syllabi (e.g., ABRSM grades) for module sequencing.
- **Structure match:** **Native.** Hierarchy is famously rigorous: intervals → scales → chords → progressions → voice-leading.
- **Audience fits:** Adult learners with *some* musical background ✅; ❌ for total beginners (frustration risk); ❌ for non-AI adult demo unless audience explicitly includes musical literacy.
- **Failure-mode flags:**
  - **Audience-filter — BLOCKING for general demo.** Requires baseline familiarity or feels alien.
  - Voice-native: **special case** — the topic *benefits* from voice (intervals are audible), but only if the VAPI agent can produce or invoke audio cues; current platform constraint check needed.
  - LO count: 6 modules × 3 LOs = **~18** → passes EMA visibility easily.
  - Misconception density: high (minor ≠ sad; sharps ≠ flats by spelling; key ≠ tonality).
- **Conditions:** Acceptable when the audience is specifically "musically-curious adult who reads a little notation." For general demo, **reject** and pick a more universal topic.
- **Demo wow line:** **Call 2** — *if the audience qualifies* — "Last call you said the minor scale sounded sad. Listen to this minor passage — does that *feel* sad? What's the song actually doing?"

---

## Adding new precedents

For a new topic to be added:

1. The Course Architect agent has run a full 9-step audit and the user has confirmed it's worth catalogue-ing.
2. The author has identified the canonical published sources (Step 3) with explicit `ContentTrustLevel` ratings.
3. The structure-match result is clear (Step 4).
4. The failure-mode sweep (Step 7) has been completed and flags are documented.
5. The demo wow line (Step 8) is specific to a call number and includes the exact "remembered me" or "caught my error" phrasing.

Add the entry under the appropriate verdict heading. Keep the catalogue alphabetised within each verdict tier.
