/**
 * Pins the N_voice bucket — Slice C follow-on (post-#1738).
 *
 * The voice 11 settings live in `lib/settings/voice-setting-contracts.ts`
 * (Settings tab citizens) but ALSO land in the Journey LH bucket
 * `N_voice` so Cmd+K → Enter on a voice setting navigates to the
 * Inspector instead of silently doing nothing.
 *
 * Invariants:
 *  1. All 11 VOICE_SETTINGS carry `menuGroupKey: "N_voice"`.
 *  2. `JOURNEY_MENU_ITEMS` contains the N_voice bucket.
 *  3. `getSettingsForBucket("N_voice")` returns all 11 voice settings.
 *  4. `JOURNEY_MENU_BUCKET_IDS` now has 14 entries.
 */

import { describe, it, expect } from "vitest";

import {
  JOURNEY_MENU_BUCKET_IDS,
  JOURNEY_MENU_ITEMS,
  JOURNEY_MENU_ITEMS_BY_ID,
} from "@/lib/journey/menu-items";
import { getSettingsForBucket } from "@/lib/journey/bucket-relations";
import { VOICE_SETTINGS } from "@/lib/settings/voice-setting-contracts";

describe("N_voice bucket — voice settings in Cmd+K + Journey LH", () => {
  it("includes N_voice in JOURNEY_MENU_BUCKET_IDS", () => {
    expect(JOURNEY_MENU_BUCKET_IDS).toContain("N_voice");
  });

  it("declares N_voice in JOURNEY_MENU_ITEMS with sensible label + caption", () => {
    const bucket = JOURNEY_MENU_ITEMS_BY_ID.N_voice;
    expect(bucket).toBeDefined();
    expect(bucket.label).toMatch(/Voice/i);
    expect(bucket.caption).toBeTruthy();
    expect(bucket.parentGroup).toBeDefined();
  });

  it("stamps all 11 VOICE_SETTINGS with menuGroupKey: 'N_voice'", () => {
    for (const v of VOICE_SETTINGS) {
      expect(
        v.menuGroupKey,
        `voice setting ${v.id} must carry menuGroupKey "N_voice"`,
      ).toBe("N_voice");
    }
  });

  it("getSettingsForBucket('N_voice') returns all 11 voice settings", () => {
    const bucket = getSettingsForBucket("N_voice");
    expect(bucket.length).toBe(VOICE_SETTINGS.length);
    const ids = new Set(bucket.map((s) => s.id));
    for (const v of VOICE_SETTINGS) {
      expect(ids.has(v.id), `bucket missing voice setting ${v.id}`).toBe(true);
    }
  });

  it("JOURNEY_MENU_ITEMS has 14 entries (was 13 pre-follow-on)", () => {
    expect(JOURNEY_MENU_ITEMS.length).toBe(14);
  });
});
