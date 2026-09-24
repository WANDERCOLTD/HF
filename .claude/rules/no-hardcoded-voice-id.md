# No hardcoded voice IDs

> Provider-catalogue voice IDs (`aura-asteria-en`, `sonic-amelia-en-female`,
> ElevenLabs UUIDs, …) MUST live in `config.voice.defaults.<provider>.voiceId`
> — never as bare literals in runtime code. The rule
> `hf-voice/no-hardcoded-voice-id` enforces this; the regex registry inside
> the rule is extensible per provider catalogue.
>
> Sibling to [`ai-callpoint-cascade.md`](./ai-callpoint-cascade.md) (model id
> cascade, same drift class one tier up). One level deeper than
> `lib/voice/default-provider.ts::DEFAULT_VOICE_PROVIDER_SLUG` which gates
> PROVIDER selection ("vapi" / "deepgram"). This rule gates voice IDs
> WITHIN a provider's catalogue.
>
> Story: [#2184](https://github.com/WANDERCOLTD/HF/issues/2184) (audit
> follow-on from epic #2176 S8 "NO HARDCODINGS").

## Rule

When you write code that needs a fallback voice ID (TTS catalogue id, NOT
the provider slug), read from `config.voice.defaults.<provider>.voiceId`:

```typescript
import { config } from "@/lib/config";

const voiceId =
  (typeof playbookVoice.voiceId === "string" && playbookVoice.voiceId) ||
  (typeof vpConfig.voiceId === "string" && vpConfig.voiceId) ||
  config.voice.defaults.deepgram.voiceId;   // <-- last-resort fallback
```

NEVER:

```typescript
// BAD — bare provider-catalogue literal
const voiceId = playbookVoice.voiceId ?? "aura-asteria-en";
```

## Why

Voice IDs are provider-catalogue-specific. Deepgram Aura, Cartesia Sonic,
and ElevenLabs each own their own naming. If a provider updates its
catalogue (e.g. `aura-asteria-en` retired in favour of `aura-aurora-en`),
a bare literal silently breaks voice synthesis — the operator hears
nothing, the chat tool returns an unexplained 404, and the failure mode
is far from the bare literal that caused it.

Routing through `config.voice.defaults.*` makes the catalogue rename a
single env-var or single-line config change. The drift class is the
same one [`ai-callpoint-cascade.md`](./ai-callpoint-cascade.md) closes
for the model-id surface — voice IDs are simply the TTS-side parallel.

## Provider regex registry — extensible

The rule's voice-ID detector is a registry of `(provider, regex)` rows
at `apps/admin/eslint-rules/no-hardcoded-voice-id.mjs`. Today:

| Provider | Pattern | Example |
|---|---|---|
| Deepgram Aura | `aura-[a-z]+-[a-z]{2}` | `aura-asteria-en` |
| Cartesia Sonic | `sonic-[a-z]+-[a-z]{2}-[a-z]+` | `sonic-amelia-en-female` |

ElevenLabs voice IDs are opaque UUIDs and need a separate detection
strategy (no canonical shape). They'll be added when ElevenLabs joins the
provider roster — author a new row in the registry + add a sibling
`config.voice.defaults.elevenlabs.voiceId` getter.

## When this applies

Any code that resolves a TTS voice id and falls back to a default when
neither the Playbook nor the VoiceProvider row supplies one. Most
acutely: the admin `test_voice` tool handler at
`lib/chat/admin-tool-handlers.ts` (the original fingerprint).

NOT applicable to:

- `lib/voice/**` — provider initialisation, catalogue getters, provider
  adapters. The rule's allow-list whitelists this tree.
- `lib/config.ts` — the catalogue defaults LIVE here.
- `app/api/voice-providers/[id]/sample/route.ts` — constructs catalogue
  model names (`aura-${voiceId}-en` template) from operator-supplied
  voiceIds at the provider's catalogue boundary.
- Tests / scripts / seed — fixtures.

## Allow-list (in the rule)

- `/lib/voice/`
- `/lib/config.ts`
- `/prisma/`
- `/scripts/`
- `/tests/` + `/__tests__/`
- `.test.` + `.spec.`
- `/app/api/voice-providers/`
- `/docs-archive/`

## Severity

Lands at `warn`. Single repaired site at land time. Promotion to `error`
in a follow-on PR once the codebase is verified clean by a sweep — same
staged pattern as `no-hardcoded-spec-slug` (HF-I).

## What NOT to do

- **Don't add a parallel resolver** in `lib/chat/` or anywhere outside
  `lib/voice/**` that reads a catalogue id from somewhere other than
  `config.voice.defaults.*`. There is one chokepoint.
- **Don't widen the rule's allow-list** to cover an unrelated file. If
  a new surface legitimately needs a literal, add a config getter for it
  AND route through that getter.
- **Don't catch voice-ID shapes the rule misses** by inlining a regex
  next to the consumer. Extend the registry inside the rule.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `eslint-rules/no-hardcoded-voice-id.mjs` (#2184) | Edit-time, `warn` severity | New bare voice-ID literals outside the allow-list |
| `lib/config.ts::config.voice.defaults` | Canonical catalogue | A single env-var override per provider |
| `lib/voice/default-provider.ts::DEFAULT_VOICE_PROVIDER_SLUG` | Sibling (provider slug) | Same drift class one tier up |
| `tests/eslint-rules/no-hardcoded-voice-id.test.ts` | smokeRule + RuleTester behavioural cases | Rule shape + behavioural drift |

## Escalation

If you're integrating a new TTS provider and can't add a regex row to the
registry in the same PR (e.g. ElevenLabs UUID voices need a separate
detection strategy), add a `// TODO(no-hardcoded-voice-id):` comment
explaining the gap. Tracked by `broken-windows`.

## Related

- [`ai-callpoint-cascade.md`](./ai-callpoint-cascade.md) — model-id
  parallel
- [`lattice-survey.md`](./lattice-survey.md) — pre-coding survey
- [`docs/lattice-chains.md`](../../docs/lattice-chains.md) — Voice / cue
  inventory row
