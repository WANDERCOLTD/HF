"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { ROLE_LEVEL } from "@/lib/roles";
import { CollapsibleCard } from "@/components/shared/CollapsibleCard";
import { SubjectsSection } from "./SubjectsSection";
import { LearnersSection } from "./LearnersSection";
import { CourseDefaultsSection } from "./CourseDefaultsSection";
import { AIPersonalitySection } from "./AIPersonalitySection";
import { WelcomeSection } from "./WelcomeSection";
import { BrandingSection } from "./BrandingSection";
import { TerminologySection } from "./TerminologySection";
import "./settings.css";

// ── Types ──────────────────────────────────────────

interface InstitutionContext {
  institution: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    primaryColor: string | null;
    secondaryColor: string | null;
    welcomeMessage: string | null;
    terminology: any;
    typeName: string | null;
  };
  domainId: string | null;
  domains: Array<{ id: string; name: string; isDefault: boolean }>;
}

// ── Institution Picker (for ADMIN+ with no assigned institution) ──

interface InstitutionSummary {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
}

function InstitutionPicker({ onSelected }: { onSelected: () => void }) {
  const [institutions, setInstitutions] = useState<InstitutionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/institutions")
      .then((r) => r.json())
      .then((data) => {
        setInstitutions(
          (data.institutions || []).filter((i: InstitutionSummary) => i.isActive)
        );
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const selectInstitution = async (id: string) => {
    setSwitching(id);
    try {
      const res = await fetch("/api/user/active-institution", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ institutionId: id }),
      });
      if (res.ok) onSelected();
    } catch {
      /* ignore */
    }
    setSwitching(null);
  };

  if (loading) {
    return (
      <div className="hf-flex hf-items-center hf-gap-sm hf-py-lg">
        <div className="hf-spinner hf-spinner-sm" />
        <span className="hf-text-sm hf-text-muted">Loading institutions...</span>
      </div>
    );
  }

  if (institutions.length === 0) {
    return (
      <div className="hf-banner hf-banner-warning">
        No institutions found. Create one first.
      </div>
    );
  }

  return (
    <div>
      <p className="hf-text-sm hf-text-muted hf-mb-md">
        Pick an institution to configure its settings.
      </p>
      <div className="hf-chip-row">
        {institutions.map((inst) => (
          <button
            key={inst.id}
            type="button"
            className="hf-chip"
            disabled={switching === inst.id}
            onClick={() => selectInstitution(inst.id)}
          >
            {switching === inst.id && <span className="hf-spinner hf-spinner-xs" />}
            {inst.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────

export default function InstitutionSettingsPage() {
  const { data: session } = useSession();
  const [ctx, setCtx] = useState<InstitutionContext | null>(null);
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsInstitutionPick, setNeedsInstitutionPick] = useState(false);

  const userRole = (session?.user as { role?: string })?.role ?? "";
  const userLevel = ROLE_LEVEL[userRole as keyof typeof ROLE_LEVEL] ?? 0;
  const canEdit = userLevel >= ROLE_LEVEL.OPERATOR;
  const isAdmin = userLevel >= ROLE_LEVEL.ADMIN;

  const loadContext = useCallback(async () => {
    setLoading(true);
    setNeedsInstitutionPick(false);
    try {
      const res = await fetch("/api/institution/context");
      const data = await res.json();
      if (data.ok) {
        setCtx(data);
        setSelectedDomainId(data.domainId || data.domains?.[0]?.id || null);
        setError(null);
      } else if (res.status === 404 && data.error === "No institution assigned") {
        setNeedsInstitutionPick(true);
        setError(null);
      } else {
        setError(data.error || "Failed to load institution");
      }
    } catch {
      setError("Failed to load institution settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadContext(); }, [loadContext]);

  if (loading) {
    return (
      <div className="hf-settings-page">
        <div className="hf-flex hf-items-center hf-gap-sm hf-py-lg">
          <div className="hf-spinner hf-spinner-sm" />
          <span className="hf-text-sm hf-text-muted">Loading settings...</span>
        </div>
      </div>
    );
  }

  if (needsInstitutionPick && isAdmin) {
    return (
      <div className="hf-settings-page">
        <div className="hf-settings-header">
          <h1 className="hf-settings-title">Institution Settings</h1>
          <p className="hf-text-sm hf-text-muted">
            You&apos;re not assigned to an institution. Pick one to configure.
          </p>
        </div>
        <InstitutionPicker onSelected={loadContext} />
      </div>
    );
  }

  if (error || !ctx) {
    return (
      <div className="hf-settings-page">
        <div className="hf-banner hf-banner-error">
          {error || "Unable to load institution settings."}
        </div>
      </div>
    );
  }

  const { institution, domains } = ctx;
  const domainId = selectedDomainId;

  return (
    <div className="hf-settings-page">
      <div className="hf-settings-header">
        <div className="hf-flex hf-items-center hf-gap-sm">
          <h1 className="hf-settings-title">{institution.name}</h1>
          {isAdmin && (
            <button
              type="button"
              className="hf-btn hf-btn-ghost hf-btn-xs"
              onClick={() => setNeedsInstitutionPick(true)}
            >
              Switch
            </button>
          )}
        </div>
        <p className="hf-text-sm hf-text-muted">
          Configure how your institution&apos;s AI works
        </p>

        {/* Domain picker — shown when user has multiple domains */}
        {domains.length > 1 && (
          <div className="hf-flex hf-items-center hf-gap-sm hf-mt-md">
            <span className="hf-text-sm hf-text-muted">Domain:</span>
            <div className="hf-chip-row">
              {domains.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`hf-chip${domainId === d.id ? " hf-chip-selected" : ""}`}
                  onClick={() => setSelectedDomainId(d.id)}
                >
                  {d.name}
                  {d.isDefault && <span className="hf-text-xs hf-text-muted hf-ml-xs">(default)</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {!domainId && domains.length === 0 && (
          <div className="hf-banner hf-banner-warning hf-mt-md">
            No active domains found. Some settings require a domain to configure.
          </div>
        )}
      </div>

      <div className="hf-settings-sections">
        {/* ── Your Teaching ───────────────────────── */}
        <div className="hf-settings-group-label">Your Teaching</div>

        <CollapsibleCard
          title="Subjects"
          hint="What subjects this institution teaches"
          defaultOpen
        >
          <SubjectsSection domainId={domainId} canEdit={canEdit} />
        </CollapsibleCard>

        <CollapsibleCard
          title="Learners"
          hint="Who your students are and how the AI adapts"
          defaultOpen
        >
          <LearnersSection domainId={domainId} canEdit={canEdit} />
        </CollapsibleCard>

        <CollapsibleCard
          title="AI Personality"
          hint="Communication style and teaching approach"
          defaultOpen
        >
          <AIPersonalitySection domainId={domainId} canEdit={canEdit} />
        </CollapsibleCard>

        {/* ── Course Setup ────────────────────────── */}
        <div className="hf-settings-group-label">Course Setup</div>

        <CollapsibleCard
          title="Course Defaults"
          hint="Starting values when creating new courses"
        >
          <CourseDefaultsSection domainId={domainId} canEdit={canEdit} />
        </CollapsibleCard>

        <CollapsibleCard
          title="Welcome Message"
          hint="First thing the AI says to new callers"
        >
          <WelcomeSection domainId={domainId} canEdit={canEdit} />
        </CollapsibleCard>

        {/* ── Your School ─────────────────────────── */}
        <div className="hf-settings-group-label">Your School</div>

        <CollapsibleCard
          title="Branding"
          hint="Logo and colours"
        >
          <BrandingSection
            institution={institution}
            canEdit={canEdit}
            onSaved={loadContext}
          />
        </CollapsibleCard>

        <CollapsibleCard
          title="Terminology"
          hint={`What we call things (${institution.typeName || "Custom"})`}
        >
          <TerminologySection canEdit={canEdit} />
        </CollapsibleCard>
      </div>
    </div>
  );
}
