"use client";

/**
 * Identity Section — Archetype, overlay summary, role statement.
 * Shows the domain's identity spec and links to layers view.
 */

import { useHolo } from "@/hooks/useHolographicState";
import { useState, useEffect } from "react";
import { Fingerprint, ArrowUpRight, Layers } from "lucide-react";
import Link from "next/link";

interface LayerDiff {
  inherited: number;
  overridden: number;
  new: number;
}

export function IdentitySection() {
  const { state } = useHolo();
  const domain = state.domainDetail as Record<string, any> | null;
  const [layerDiff, setLayerDiff] = useState<LayerDiff | null>(null);

  const identitySpec = domain?.onboardingIdentitySpec;
  const institution = domain?.institution;
  const archetype = institution?.type?.defaultArchetypeSlug;

  // Lazy-load layer diff if we have an identity spec
  useEffect(() => {
    if (!identitySpec?.id) return;
    fetch(`/api/layers/diff?overlayId=${identitySpec.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.diff) {
          const params = data.diff.parameters || [];
          setLayerDiff({
            inherited: params.filter((p: any) => p.classification === "INHERITED").length,
            overridden: params.filter((p: any) => p.classification === "OVERRIDDEN").length,
            new: params.filter((p: any) => p.classification === "NEW").length,
          });
        }
      })
      .catch(() => {});
  }, [identitySpec?.id]);

  if (!domain) {
    return <div className="hp-section-empty">No domain data loaded.</div>;
  }

  return (
    <div className="hp-section-identity">
      {/* Archetype badge */}
      <div className="hp-identity-archetype">
        <Fingerprint size={18} className="hp-identity-icon" />
        <div>
          <div className="hp-identity-label">Base Archetype</div>
          <div className="hp-identity-value">
            {archetype || "None set"}
          </div>
        </div>
      </div>

      {/* Identity overlay spec */}
      {identitySpec ? (
        <div className="hp-identity-overlay">
          <div className="hp-identity-overlay-header">
            <div>
              <div className="hp-identity-label">Domain Overlay</div>
              <div className="hp-identity-value">{identitySpec.name}</div>
              <div className="hp-identity-slug">{identitySpec.slug}</div>
            </div>
            <Link
              href="/x/layers"
              className="hp-section-link"
              title="View layers"
            >
              <Layers size={14} />
              View Layers
              <ArrowUpRight size={12} />
            </Link>
          </div>

          {/* Layer diff summary */}
          {layerDiff && (
            <div className="hp-layer-diff">
              <span className="hp-diff-chip hp-diff-inherited">
                {layerDiff.inherited} inherited
              </span>
              <span className="hp-diff-chip hp-diff-overridden">
                {layerDiff.overridden} overridden
              </span>
              <span className="hp-diff-chip hp-diff-new">
                {layerDiff.new} new
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="hp-identity-empty">
          <div className="hp-identity-label">No identity overlay configured</div>
          <div className="hp-section-empty-hint">
            Create a domain overlay via the Domains page or Teach wizard.
          </div>
        </div>
      )}

      {/* Institution info */}
      {institution && (
        <div className="hp-identity-institution">
          <div className="hp-identity-label">Institution</div>
          <div className="hp-identity-value">{institution.name}</div>
          {institution.type && (
            <div className="hp-identity-slug">{institution.type.name}</div>
          )}
        </div>
      )}
    </div>
  );
}
