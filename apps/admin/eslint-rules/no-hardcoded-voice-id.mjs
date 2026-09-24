/**
 * #2184 — block hardcoded voice-ID string literals in runtime code.
 *
 * Voice IDs are provider-catalogue-specific. Deepgram's Aura voices
 * (`aura-asteria-en`, `aura-helios-en`, …), Cartesia's Sonic voices
 * (`sonic-amelia-en-…`), ElevenLabs UUID voices — each provider owns
 * its own naming. If Deepgram updates its catalogue (e.g.
 * `aura-asteria-en` → `aura-aurora-en`), a bare literal silently breaks
 * voice synthesis without surfacing a config-side decision.
 *
 * Sibling pattern: `lib/voice/default-provider.ts::DEFAULT_VOICE_PROVIDER_SLUG`
 * gates PROVIDER selection ("vapi" / "deepgram"). This rule extends the
 * principle one level deeper to the voice IDs WITHIN a provider's catalogue.
 *
 * The provider regex registry is extensible — new providers slot in
 * by adding a `{ provider, pattern }` row. Today's coverage:
 *   - Deepgram Aura: `aura-<voice>-<lang2>` (e.g. `aura-asteria-en`)
 *   - Cartesia Sonic: `sonic-<voice>-<lang2>-<variant>` (e.g. `sonic-amelia-en-female`)
 *   - ElevenLabs UUID voices: handled later (different shape — opaque IDs)
 *
 * Greenlit (allow-list):
 *   - `lib/voice/**` — provider initialization, catalogue getters
 *   - `lib/config.ts` — `config.voice.defaults` lives here
 *   - `prisma/seed/**` — seed data is allowed
 *   - `scripts/**` — operator tools
 *   - `.test.ts` / `.test.tsx` / `.spec.ts` — fixtures
 *   - `app/api/voice-providers/**` — provider sample/catalogue routes
 *
 * Severity: `warn` at landing (low hit count — single repaired site at land time).
 * Promotion to `error` in a follow-on PR once the codebase is verified clean.
 * See `.claude/rules/no-hardcoded-voice-id.md`.
 */

// Provider regex registry — extensible. Each entry checks a voice-ID shape
// produced by a single provider's catalogue.
const VOICE_ID_PATTERNS = [
  {
    provider: "deepgram-aura",
    // `aura-asteria-en`, `aura-helios-en`, `aura-luna-en`, `aura-orion-en`, `aura-stella-en`, …
    re: /^aura-[a-z]+-[a-z]{2}$/,
  },
  {
    provider: "cartesia-sonic",
    // `sonic-amelia-en-female`, `sonic-marcus-en-male`, … (Cartesia's compound shape)
    re: /^sonic-[a-z]+-[a-z]{2}-[a-z]+$/,
  },
];

function matchesAnyVoiceIdPattern(value) {
  for (const { provider, re } of VOICE_ID_PATTERNS) {
    if (re.test(value)) return provider;
  }
  return null;
}

// Path fragments where voice-ID literals are legitimate (provider initialisation,
// config defaults, catalogue getters, seed/fixtures, operator scripts).
const ALLOWLIST_PATH_FRAGMENTS = [
  "/lib/voice/",
  "/lib/config.ts",
  "/prisma/",
  "/scripts/",
  "/tests/",
  "/__tests__/",
  ".test.",
  ".spec.",
  "/docs-archive/",
  // Voice provider sample endpoints construct model names from the
  // catalogue — they're the catalogue surface, not consumers of it.
  "/app/api/voice-providers/",
];

// Only guard runtime source trees.
const GUARDED_PATH_FRAGMENTS = ["/lib/", "/app/"];

function isGuardedFile(filename) {
  if (!filename) return false;
  const normalised = filename.replace(/\\/g, "/");
  if (ALLOWLIST_PATH_FRAGMENTS.some((p) => normalised.includes(p))) return false;
  return GUARDED_PATH_FRAGMENTS.some((p) => normalised.includes(p));
}

const messages = {
  hardcoded:
    "Hardcoded voice ID `{{voiceId}}` (provider catalogue: {{provider}}) in runtime code. " +
    "Voice IDs are provider-catalogue-specific — when the provider updates its catalogue, " +
    "the bare literal silently breaks voice synthesis. Read from `config.voice.defaults.<provider>.voiceId` " +
    "(lib/config.ts) instead, or add a getter there if one doesn't exist. " +
    "Sibling: `lib/voice/default-provider.ts::DEFAULT_VOICE_PROVIDER_SLUG`. " +
    "See `.claude/rules/no-hardcoded-voice-id.md` + #2184.",
};

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Block hardcoded provider-catalogue voice-ID string literals in lib/ + app/ runtime code; use config.voice.defaults.*. See #2184.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-hardcoded-voice-id",
    },
    schema: [],
    messages,
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.();
    const guarded = isGuardedFile(filename);
    return {
      Literal(node) {
        if (!guarded) return;
        if (typeof node.value !== "string") return;
        const provider = matchesAnyVoiceIdPattern(node.value);
        if (!provider) return;
        context.report({
          node,
          messageId: "hardcoded",
          data: { voiceId: node.value, provider },
        });
      },
    };
  },
};

export default rule;
