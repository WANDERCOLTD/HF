"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Building2, Users } from "lucide-react";
import { WizardSummary } from "@/components/shared/WizardSummary";
import { StepFooter } from "@/components/wizards/StepFooter";
import { useBranding } from "@/contexts/BrandingContext";
import type { StepRenderProps } from "@/components/wizards/types";

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

type Phase = "review" | "creating" | "success" | "error";

export function LaunchStep({ getData, setData, onPrev, endFlow }: StepRenderProps) {
  const router = useRouter();
  const { refreshBranding } = useBranding();

  // Read all wizard data
  const institutionName = getData<string>("institutionName") ?? "";
  const typeSlug = getData<string>("typeSlug") ?? null;
  const typeId = getData<string>("typeId");
  const logoUrl = getData<string>("logoUrl") ?? "";
  const primaryColor = getData<string>("primaryColor") ?? "";
  const secondaryColor = getData<string>("secondaryColor") ?? "";
  const welcomeMessage = getData<string>("welcomeMessage") ?? "";
  const terminologyOverrides = getData<Record<string, string>>("terminologyOverrides") ?? null;

  // Resume support: if IDs already set (e.g. page refresh after success), go straight to success
  const savedInstId = getData<string>("createdInstitutionId");
  const savedDomainId = getData<string>("createdDomainId");

  const [phase, setPhase] = useState<Phase>(
    savedInstId && savedDomainId ? "success" : "review",
  );
  const [error, setError] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    setPhase("creating");
    setError(null);

    try {
      const slug = toSlug(institutionName);

      // Step 1: Create institution
      const instBody: Record<string, unknown> = {
        name: institutionName,
        slug,
        logoUrl: logoUrl || null,
        primaryColor: primaryColor || null,
        secondaryColor: secondaryColor || null,
        welcomeMessage: welcomeMessage || null,
      };
      if (typeId) instBody.typeId = typeId;
      else if (typeSlug) instBody.typeSlug = typeSlug;
      if (terminologyOverrides) instBody.terminologyOverrides = terminologyOverrides;

      const instRes = await fetch("/api/institutions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(instBody),
      });
      const instData = await instRes.json();
      if (!instData.ok) {
        setError(instData.error || "Failed to create institution");
        setPhase("error");
        return;
      }
      const institutionId: string = instData.institution.id;

      // Step 2: Create domain linked to institution
      const domRes = await fetch("/api/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: institutionName, slug, institutionId }),
      });
      const domData = await domRes.json();
      if (!domData.ok) {
        setError(domData.error || "Failed to create domain");
        setPhase("error");
        return;
      }
      const domainId: string = domData.domain.id;

      // Step 3: Scaffold domain
      await fetch(`/api/domains/${domainId}/scaffold`, { method: "POST" });

      // Step 4: Link user to institution
      await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeInstitutionId: institutionId }),
      });

      // Step 5: Refresh branding so sidebar updates
      refreshBranding();

      // Persist created IDs in data bag (resume support on refresh)
      setData("createdInstitutionId", institutionId);
      setData("createdDomainId", domainId);

      setPhase("success");
    } catch {
      setError("Network error. Please try again.");
      setPhase("error");
    }
  }, [
    institutionName,
    typeId,
    typeSlug,
    logoUrl,
    primaryColor,
    secondaryColor,
    welcomeMessage,
    terminologyOverrides,
    refreshBranding,
    setData,
  ]);

  // ── Success ───────────────────────────────────────────────
  if (phase === "success") {
    const createdInstId = getData<string>("createdInstitutionId");
    const createdDomId = getData<string>("createdDomainId");
    if (!createdInstId || !createdDomId) return null;

    return (
      <div className="hf-wizard-page">
        <div className="hf-wizard-step">
          <WizardSummary
            title={`${institutionName} is ready`}
            subtitle="Your institution has been created and scaffolded."
            intent={{
              items: [
                { label: "Name", value: institutionName },
                ...(typeSlug ? [{ label: "Type", value: typeSlug }] : []),
                ...(primaryColor ? [{ label: "Branding", value: "Custom colours set" }] : []),
                ...(welcomeMessage
                  ? [
                      {
                        label: "Welcome",
                        value: `${welcomeMessage.slice(0, 60)}${welcomeMessage.length > 60 ? "…" : ""}`,
                      },
                    ]
                  : []),
              ],
            }}
            created={{
              entities: [
                {
                  icon: <Building2 className="hf-icon-md" />,
                  label: "Institution",
                  name: institutionName,
                  href: `/x/institutions/${createdInstId}`,
                },
              ],
            }}
            primaryAction={{
              label: "Create a Course",
              icon: <BookOpen className="hf-icon-md" />,
              onClick: () => {
                endFlow();
                // Thread domainId so the course wizard pre-selects this institution
                router.push(`/x/courses/new?domainId=${createdDomId}`);
              },
            }}
            secondaryActions={[
              {
                label: "View Institution",
                icon: <Building2 className="hf-icon-md" />,
                onClick: () => {
                  endFlow();
                  router.push(`/x/institutions/${createdInstId}`);
                },
              },
              {
                label: "Invite Team",
                icon: <Users className="hf-icon-md" />,
                onClick: () => {
                  endFlow();
                  router.push("/x/users");
                },
              },
            ]}
          />
        </div>
      </div>
    );
  }

  // ── Creating ──────────────────────────────────────────────
  if (phase === "creating") {
    return (
      <div className="hf-wizard-page">
        <div className="hf-wizard-step hf-flex hf-flex-col hf-items-center hf-justify-center hf-text-center">
          <div className="hf-flex hf-justify-center hf-mb-md">
            <div className="hf-spinner hf-icon-xl hf-spinner-thick" />
          </div>
          <h1 className="hf-page-title hf-mb-xs">Creating {institutionName}…</h1>
          <p className="hf-page-subtitle">Setting up your institution and scaffolding…</p>
        </div>
        <div className="hf-step-footer">
          <button type="button" disabled className="hf-btn hf-btn-ghost" style={{ opacity: 0.4 }}>Back</button>
          <button type="button" disabled className="hf-btn hf-btn-primary" style={{ opacity: 0.6 }}>
            <div className="hf-spinner hf-icon-xs" style={{ marginRight: 6 }} />
            Creating…
          </button>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────
  if (phase === "error") {
    return (
      <div className="hf-wizard-page">
        <div className="hf-wizard-step hf-flex hf-flex-col hf-items-center hf-justify-center hf-text-center">
          <div className="hf-text-xl hf-mb-md">❌</div>
          <h1 className="hf-page-title hf-mb-xs">Creation failed</h1>
          <p className="hf-page-subtitle hf-mb-lg">{error || "An error occurred"}</p>
        </div>
        <div className="hf-step-footer">
          <button type="button" onClick={onPrev} className="hf-btn hf-btn-ghost">Back</button>
          <button type="button" onClick={handleCreate} className="hf-btn hf-btn-primary">Retry</button>
        </div>
      </div>
    );
  }

  // ── Pre-launch review ─────────────────────────────────────
  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">
        <WizardSummary
          title={`Launch ${institutionName || 'Institution'}`}
          subtitle="Review your details and launch when ready."
          intent={{
            items: [
              { icon: <Building2 className="hf-icon-sm" />, label: "Name", value: institutionName || "—" },
              ...(typeSlug ? [{ label: "Type", value: typeSlug }] : []),
              ...(primaryColor ? [{ label: "Branding", value: "Custom colours set" }] : []),
              ...(welcomeMessage ? [{ label: "Welcome", value: `${welcomeMessage.slice(0, 60)}${welcomeMessage.length > 60 ? "…" : ""}` }] : []),
            ],
          }}
          primaryAction={{
            label: "Launch Institution",
            icon: <Building2 className="hf-icon-md" />,
            onClick: handleCreate,
          }}
          secondaryActions={[
            { label: "Cancel", onClick: () => { endFlow(); } },
          ]}
          onBack={onPrev}
        />
      </div>
    </div>
  );
}
