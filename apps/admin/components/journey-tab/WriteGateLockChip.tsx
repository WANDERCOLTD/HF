"use client";

/**
 * WriteGateLockChip — Slice C3 of epic #1675 (#1738).
 *
 * Renders a small lock chip above a setting row when the contract
 * carries `writeGate: "operator-only"`. The chip is operator-visible
 * UI for a chain-contract boundary: the adaptive pipeline must NEVER
 * mutate this setting (see `docs/CHAIN-CONTRACTS.md` and the
 * `JourneySettingContract.writeGate` field's JSDoc).
 *
 * The chip itself is non-interactive — it's a status signal. Operators
 * can still edit the setting through the Inspector (they have the
 * authority to). The chip exists so:
 *
 *   1. Operators learn at a glance which settings the loop won't touch
 *      (no surprise when AGGREGATE / ADAPT silently leaves them as-is).
 *   2. Reviewers reading the screen see the same signal the registry
 *      enforces server-side.
 *
 * Sibling pattern: `<LayerBadge>` for cascade provenance,
 * `<JourneyTargets>` slider repeater for compound primitives. This
 * is intentionally minimal — purely declarative.
 */

import { Lock } from "lucide-react";

import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

interface WriteGateLockChipProps {
  contract: JourneySettingContract;
}

export function WriteGateLockChip({ contract }: WriteGateLockChipProps) {
  if (contract.writeGate !== "operator-only") return null;

  return (
    <span
      className="hf-writegate-lock-chip"
      data-testid={`hf-writegate-lock-${contract.id}`}
      role="status"
      title="Operator-only: the adaptive pipeline never mutates this setting (chain-contract boundary)."
    >
      <Lock size={10} aria-hidden focusable="false" />
      <span>Operator-only</span>
    </span>
  );
}
