# lib/intake/copy/

Disclosure / consent / Terms-of-Service / Acceptable-Use copy for the Phase 1 enrolment intake.

## Status — all files are `v0.1.0-DRAFT`

```
DO NOT SHIP TO PRODUCTION.
```

These are placeholders authored during the Sprint C spike. They:

- Use the canonical stub format locked in GitHub issue #993 ("Placeholder copy approach")
- Carry the regulation citation, version, effective date, controller, DPO contact in a structured header
- Contain section skeletons (Purpose / Legal basis / Retention / Recipients / Rights / Contact) populated with lorem ipsum at realistic target lengths
- Are bound to a content hash (`sha256(canonicalised body + version + locale)`) by the runtime — when real text lands post-counsel, the hash changes; all prior consents are auditably tied to the placeholder version
- Carry `metadata.status: 'DRAFT'` — `apps/admin/lib/intake/hf-adapter/disclosure-content.ts` refuses to deliver DRAFT copy when `NODE_ENV === 'production'`

## File naming

`<requirement-id>.<semver>-DRAFT.mdx` — e.g. `gdpr-art13-privacy.v0.1.0-DRAFT.mdx`.

Semver discipline:
- **MAJOR** — meaning change (e.g. new lawful basis added)
- **MINOR** — substantive wording (e.g. retention period changed)
- **PATCH** — typo / formatting fix
- **-DRAFT** suffix — pre-counsel
- **-rc.N** suffix — counsel-reviewed, awaiting sign-off

The hash binds the exact body delivered. Bumping the version forces a fresh ConsentGranted / DisclosureDelivered event chain — old hashes remain in history as audit-trail evidence of what each prior data subject saw.

## Inventory

| File | Regulation | Target words |
|---|---|---|
| `gdpr-art13-privacy.v0.1.0-DRAFT.mdx` | GDPR Art 13 | 300-500 |
| `eu-ai-act-art50-ai-disclosure.v0.1.0-DRAFT.mdx` | EU AI Act Art 50(1) | 60-100 |
| `gdpr-art22-3-automated-decision.v0.1.0-DRAFT.mdx` | GDPR Art 22(3) | 60-100 |
| `tos-summary.v0.1.0-DRAFT.mdx` | Platform ToS | 30-60 + link |
| `aup-ai-tutor.v0.1.0-DRAFT.mdx` | Acceptable Use of AI Tutor | 30-60 + link |
| `marketing-optin-description.v0.1.0-DRAFT.mdx` | Marketing consent (Art 7) | 20-40 |

## Counsel-review checklist (when these graduate from DRAFT)

For each file:

- [ ] Controller details correct (legal name, DPO contact, registration)
- [ ] Purpose section enumerates all uses (not just enrolment — adaptive tutoring, cohort analytics, etc.)
- [ ] Legal basis aligns with `lib/intake/compliance.ts` lawfulBasis map
- [ ] Retention aligns with `lib/intake/compliance.ts` retention policy
- [ ] Recipients section names all sub-processors (Anthropic, hosting provider, etc.)
- [ ] Rights section covers Art 15-22 + Art 7(3) withdrawal where applicable
- [ ] Plain-language readability tested (target: B1-B2 CEFR / Flesch ≥ 60)
- [ ] Translations queued for HF's supported locales (currently `en` only)
- [ ] Effective date set + previous version archived to `archive/`
- [ ] Remove `-DRAFT` suffix; bump to `v0.1.0-rc.1` then `v0.1.0`

## Reference

- Sprint C scope: GitHub issue #993 § "Placeholder copy approach"
- Storage strategy: GitHub issue #993 § "Copy + version storage management"
- Runtime delivery: `lib/intake/hf-adapter/disclosure-content.ts` (to be added — implements `DisclosureContentPort`)
