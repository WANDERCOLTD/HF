/**
 * VOICE_SETTINGS render coverage — Lattice Coverage-pillar member (2026-06-17).
 *
 * **What this test pins:**
 *  Every `VOICE_SETTINGS` entry MUST be reachable from at least one
 *  educator UI surface. Two acceptable surfaces today:
 *
 *    1. `CommandPalette.tsx` — uses `...VOICE_SETTINGS` spread, so
 *       every entry is auto-discovered into Cmd+K search.
 *    2. `VoiceConfigSection.tsx` — hardcoded `keys: [...]` array per
 *       section. Settings explicitly listed here render as inline
 *       config controls.
 *
 *  The 2026-06-17 Lattice audit found that VOICE_SETTINGS has 11
 *  entries but VoiceConfigSection's hardcoded keys array only listed
 *  3 of them (`voiceProvider`, `voiceId`, `backgroundSound`). The
 *  other 8 are reachable only via Cmd+K. This Coverage test pins:
 *
 *    - 3 settings rendered inline via VoiceConfigSection
 *    - 8 settings on the "command-palette-only" exempt list with
 *      documented reason
 *    - Removing the `...VOICE_SETTINGS` spread from CommandPalette
 *      breaks the test for all 8 exempt entries (their exempt reason
 *      cites the spread)
 *
 *  See `.claude/rules/voice-settings-render-coverage.md`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { VOICE_SETTINGS } from "@/lib/settings/voice-setting-contracts";

const REPO_ADMIN = resolve(__dirname, "..", "..", "..");

const VOICE_CONFIG_SECTION_SRC: string = (() => {
  try {
    return readFileSync(
      join(REPO_ADMIN, "components", "voice", "VoiceConfigSection.tsx"),
      "utf8",
    );
  } catch {
    return "";
  }
})();

const COMMAND_PALETTE_SRC: string = (() => {
  try {
    return readFileSync(
      join(REPO_ADMIN, "components", "journey-tab", "CommandPalette.tsx"),
      "utf8",
    );
  } catch {
    return "";
  }
})();

// ────────────────────────────────────────────────────────────
// Exempt list — VOICE_SETTINGS entries not yet rendered inline in
// VoiceConfigSection. Each entry MUST cite the alternative surface
// (currently: CommandPalette spread + Tuning tab auto-discovery).
// ────────────────────────────────────────────────────────────

interface ExemptEntry {
  reason: string;
}

const RENDER_EXEMPT: Record<string, ExemptEntry> = {
  interruptSensitivity: {
    reason:
      "Reachable via CommandPalette spread (...VOICE_SETTINGS) + Tuning tab auto-discovery via prisma.parameter.findMany. VoiceConfigSection inline render is the follow-on.",
  },
  voiceSpeed: {
    reason:
      "Reachable via CommandPalette spread + Tuning tab. VoiceConfigSection inline render is the follow-on.",
  },
  voicePitch: {
    reason:
      "Reachable via CommandPalette spread + Tuning tab. VoiceConfigSection inline render is the follow-on.",
  },
  silenceThreshold: {
    reason:
      "Reachable via CommandPalette spread + Tuning tab. VoiceConfigSection covers `silenceTimeoutSeconds` (different field). Naming overlap — clarify in follow-on.",
  },
  endCallAfterSilence: {
    reason:
      "Reachable via CommandPalette spread + Tuning tab. VoiceConfigSection covers `silenceTimeoutSeconds` (different field) and `endCallPhrases`. Follow-on to unify.",
  },
  maxCallDuration: {
    reason:
      "Reachable via CommandPalette spread + Tuning tab. VoiceConfigSection covers `maxDurationSeconds` (different field name). Follow-on to unify naming.",
  },
  phoneNumber: {
    reason:
      "Reachable via CommandPalette spread + Tuning tab. VoiceConfigSection covers `phoneNumberId` (different field — ID vs human-readable). Follow-on.",
  },
  vapiAssistantId: {
    reason:
      "Reachable via CommandPalette spread + Tuning tab. Implementation-specific — may not need inline UI exposure.",
  },
};

const EXPECTED_EXEMPT_COUNT = 8;

// ────────────────────────────────────────────────────────────
// Classification
// ────────────────────────────────────────────────────────────

type Classification = "inline-rendered" | "exempt" | "gap";

interface SettingResult {
  id: string;
  classification: Classification;
  reason?: string;
}

function classify(id: string): SettingResult {
  if (RENDER_EXEMPT[id]) {
    return { id, classification: "exempt", reason: RENDER_EXEMPT[id].reason };
  }
  // Inline-rendered: appears as a quoted string in VoiceConfigSection's
  // hardcoded keys array.
  if (VOICE_CONFIG_SECTION_SRC.includes(`"${id}"`)) {
    return { id, classification: "inline-rendered" };
  }
  return { id, classification: "gap" };
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("VOICE_SETTINGS render coverage (Lattice Coverage pillar)", () => {
  const results = VOICE_SETTINGS.map((s) => classify(s.id));

  it("every VOICE_SETTINGS entry either renders inline or is exempt with reason", () => {
    const gaps = results.filter((r) => r.classification === "gap");
    expect(
      gaps,
      `VOICE_SETTINGS entries not rendered inline in VoiceConfigSection and not exempt:\n  ${gaps
        .map((g) => g.id)
        .join("\n  ")}\n\nFix: either add the id to a section's keys array in VoiceConfigSection.tsx, OR add to RENDER_EXEMPT with a reason citing the alternative reach surface.`,
    ).toEqual([]);
  });

  it("ratchet — exempt list pinned at EXPECTED_EXEMPT_COUNT", () => {
    const exemptIds = Object.keys(RENDER_EXEMPT);
    expect(
      exemptIds.length,
      `Render-exempt count drifted from ${EXPECTED_EXEMPT_COUNT}. ` +
        `If a setting moved into VoiceConfigSection inline rendering, drop EXPECTED_EXEMPT_COUNT by 1. ` +
        `Current entries: ${exemptIds.join(", ")}`,
    ).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every exempt entry has a non-empty reason (>20 chars)", () => {
    for (const [id, entry] of Object.entries(RENDER_EXEMPT)) {
      expect(entry.reason.trim().length, `${id}: empty/short reason`).toBeGreaterThan(20);
    }
  });

  it("every exempt id still exists in VOICE_SETTINGS", () => {
    const known = new Set(VOICE_SETTINGS.map((s) => s.id));
    const stale = Object.keys(RENDER_EXEMPT).filter((id) => !known.has(id));
    expect(
      stale,
      `Exempt entries for VOICE_SETTINGS ids that no longer exist — registry deleted the setting; remove the exempt row:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });

  it("exempt entries citing CommandPalette spread — verify the spread still exists", () => {
    // If the `...VOICE_SETTINGS` spread is removed from CommandPalette,
    // the 8 exempt entries' "reachable via spread" reason becomes false.
    // This test pins the load-bearing infrastructure that makes the
    // exemptions valid.
    expect(
      COMMAND_PALETTE_SRC.includes("...VOICE_SETTINGS"),
      "CommandPalette no longer spreads VOICE_SETTINGS. The 8 RENDER_EXEMPT entries " +
        "rely on this spread for educator reachability. Either restore the spread OR " +
        "wire each exempt id into VoiceConfigSection inline AND clear the exempt list.",
    ).toBe(true);
  });

  it("no exempt entry is now inline-rendered (would mean a row should be removed)", () => {
    const contradicted: string[] = [];
    for (const id of Object.keys(RENDER_EXEMPT)) {
      if (VOICE_CONFIG_SECTION_SRC.includes(`"${id}"`)) {
        contradicted.push(id);
      }
    }
    expect(
      contradicted,
      `Exempt VOICE_SETTINGS now inline-rendered in VoiceConfigSection — remove from RENDER_EXEMPT:\n  ${contradicted.join("\n  ")}`,
    ).toEqual([]);
  });
});
