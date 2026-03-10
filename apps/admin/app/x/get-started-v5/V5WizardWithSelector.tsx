"use client";

import { useState, useEffect } from "react";
import { FancySelect } from "@/components/shared/FancySelect";
import type { FancySelectOption } from "@/components/shared/FancySelect";
import { ConversationalWizard } from "../get-started-v4/components/ConversationalWizard";
import type { WizardInitialContext } from "../get-started-v4/components/ConversationalWizard";
import "./get-started-v5.css";

/* ── Types ──────────────────────────────────────────────── */

interface InstitutionFromAPI {
  id: string;
  name: string;
  typeSlug: string | null;
  defaultDomainKind: string | null;
  domainId: string | null;
}

interface V5WizardWithSelectorProps {
  defaultInstitution: {
    id: string;
    name: string;
    domainId: string;
    domainKind: "INSTITUTION" | "COMMUNITY";
    typeSlug: string | null;
  } | null;
  userRole: string;
}

/* ── Component ──────────────────────────────────────────── */

export function V5WizardWithSelector({ defaultInstitution, userRole }: V5WizardWithSelectorProps) {
  const [institutions, setInstitutions] = useState<InstitutionFromAPI[]>([]);
  const [selectedId, setSelectedId] = useState(defaultInstitution?.id ?? "");
  const [loading, setLoading] = useState(false);

  const isSuperAdmin = userRole === "SUPERADMIN";

  // Fetch institution list on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/user/institutions")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const list: InstitutionFromAPI[] = data.institutions ?? [];
        setInstitutions(list);
        // If no default was set server-side, pick first from list
        if (!selectedId && list.length > 0) setSelectedId(list[0].id);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Show selector for SUPERADMIN always, or anyone with 2+ institutions
  const showSelector = isSuperAdmin || institutions.length >= 2;

  // Build FancySelect options
  const options: FancySelectOption[] = institutions.map((inst) => ({
    value: inst.id,
    label: inst.name,
    subtitle: inst.typeSlug?.replace(/-/g, " ") ?? "Organisation",
  }));

  // Build WizardInitialContext from selected institution
  const selected = institutions.find((i) => i.id === selectedId);
  const initialContext: WizardInitialContext | undefined =
    selected && selected.domainId
      ? {
          institutionName: selected.name,
          institutionId: selected.id,
          domainId: selected.domainId,
          domainKind: (selected.defaultDomainKind as "INSTITUTION" | "COMMUNITY") ?? "INSTITUTION",
          typeSlug: selected.typeSlug,
          userRole,
        }
      : defaultInstitution
        ? {
            institutionName: defaultInstitution.name,
            institutionId: defaultInstitution.id,
            domainId: defaultInstitution.domainId,
            domainKind: defaultInstitution.domainKind,
            typeSlug: defaultInstitution.typeSlug,
            userRole,
          }
        : undefined;

  return (
    <>
      {showSelector && (
        <div className="v5-institution-bar">
          <label className="hf-text-xs hf-text-muted">Organisation</label>
          <FancySelect
            value={selectedId}
            onChange={setSelectedId}
            options={options}
            searchable
            loading={loading}
            placeholder="Select organisation..."
          />
        </div>
      )}
      <ConversationalWizard
        key={`v5-${selectedId}`}
        initialContext={initialContext}
        userRole={userRole}
        wizardVersion="v5"
      />
    </>
  );
}
