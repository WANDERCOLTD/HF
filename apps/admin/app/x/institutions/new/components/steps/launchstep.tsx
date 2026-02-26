"use client";

import { useState, useCallback, useRef } from "react";
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

type TimelineStep = {
  id: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
};

type CourseCheck = {
  id: string;
  label: string;
  severity: "critical" | "recommended" | "optional";
  passed: boolean;
  fixAction?: { label: string; href: string };
};

export function LaunchStep({ getData, setData, onPrev, endFlow }: StepRenderProps) {
  const router = useRouter();
  const { refreshBranding } = useBranding();

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
  const [commitTimeline, setCommitTimeline] = useState<TimelineStep[]>([]);
  const [courseChecks, setCourseChecks] = useState<CourseCheck[]>([]);
  const commitAbortRef = useRef<AbortController | null>(null);

  // ── SSE event handler ──
  const handleCommitEvent = useCallback((event: { phase: string; message: string; detail?: Record<string, unknown> }) => {
    const { phase: evtPhase, message, detail } = event;

    if (evtPhase === "complete" && detail) {
      const institutionId = detail.institutionId as string;
      const domainId = detail.domainId as string;

      setData("createdInstitutionId", institutionId);
      setData("createdDomainId", domainId);
      refreshBranding();
      setPhase("success");

      // Fetch post-creation readiness checks
      fetch(`/api/domains/${domainId}/course-readiness`)
        .then((r) => r.json())
        .then((data) => {
          if (data.ok && data.checks?.length > 0) setCourseChecks(data.checks);
        })
        .catch(() => {});

      return;
    }

    if (evtPhase === "error") {
      setError(message);
      setPhase("error");
      return;
    }

    if (evtPhase === "init") return;

    // Update timeline: mark previous active as done, add/update current phase
    setCommitTimeline((prev) => {
      const existing = prev.find((s) => s.id === evtPhase);
      const isDone = message.includes("✓");

      if (existing) {
        return prev.map((s) => {
          if (s.id === evtPhase) return { ...s, status: isDone ? "done" : "active", label: message };
          if (s.status === "active" && !isDone) return { ...s, status: "done" };
          return s;
        });
      }

      const updated = prev.map((s) =>
        s.status === "active" ? { ...s, status: "done" as const } : s,
      );
      return [...updated, { id: evtPhase, label: message, status: isDone ? "done" : ("active" as const) }];
    });
  }, [setData, refreshBranding]);

  // ── Launch handler — SSE fetch ──
  const handleCreate = useCallback(async () => {
    setPhase("creating");
    setCommitTimeline([]);
    setError(null);

    commitAbortRef.current?.abort();
    const controller = new AbortController();
    commitAbortRef.current = controller;

    const slug = toSlug(institutionName);

    try {
      const res = await fetch("/api/institutions/launch", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          institutionName,
          slug,
          logoUrl: logoUrl || null,
          primaryColor: primaryColor || null,
          secondaryColor: secondaryColor || null,
          welcomeMessage: welcomeMessage || null,
          typeId: typeId || null,
          typeSlug: typeSlug || null,
          terminologyOverrides: terminologyOverrides || null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Server error: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const block of lines) {
          const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            handleCommitEvent(JSON.parse(dataLine.slice(6)));
          } catch {
            // Ignore malformed events
          }
        }
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        const dataLine = buffer.split("\n").find((l) => l.startsWith("data: "));
        if (dataLine) {
          try {
            handleCommitEvent(JSON.parse(dataLine.slice(6)));
          } catch {
            // Ignore
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") {
        setPhase("review");
        return;
      }
      const msg = (err as Error).message || "Creation failed";
      const isNetworkError =
        msg === "Load failed" ||
        msg === "Failed to fetch" ||
        msg === "NetworkError when attempting to fetch resource.";
      setError(
        isNetworkError
          ? "Connection lost — check your network and try again."
          : msg,
      );
      setPhase("error");
    }
  }, [institutionName, logoUrl, primaryColor, secondaryColor, welcomeMessage, typeId, typeSlug, terminologyOverrides, handleCommitEvent]);

  const handleCancelCommit = () => {
    commitAbortRef.current?.abort();
    setPhase("review");
  };

  // ── Success ──
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
                  ? [{ label: "Welcome", value: `${welcomeMessage.slice(0, 60)}${welcomeMessage.length > 60 ? "…" : ""}` }]
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

          {courseChecks.length > 0 && (
            <div className="hf-mt-lg">
              <p className="hf-section-title">Next steps</p>
              {courseChecks.map((c) => (
                <div key={c.id} className="hf-list-row hf-flex hf-items-center hf-gap-sm">
                  <span>{c.passed ? "✅" : c.severity === "critical" ? "🔴" : "🟡"}</span>
                  <span className="hf-flex-1 hf-text-sm">{c.label}</span>
                  {!c.passed && c.fixAction && (
                    <a href={c.fixAction.href} className="hf-btn hf-btn-secondary hf-btn-sm">
                      {c.fixAction.label} →
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Creating — live timeline ──
  if (phase === "creating") {
    return (
      <div className="hf-wizard-page">
        <div className="hf-wizard-step">
          <h1 className="hf-page-title hf-mb-xs">Creating {institutionName}…</h1>
          <p className="hf-page-subtitle hf-mb-lg">Setting up your institution and scaffolding…</p>

          {commitTimeline.length > 0 && (
            <div className="hf-card hf-card-compact hf-mb-lg">
              {commitTimeline.map((step) => (
                <div key={step.id} className="hf-flex hf-items-center hf-gap-sm hf-mb-xs">
                  {step.status === "done" && <span style={{ color: "var(--status-success-text)", fontSize: 14 }}>✓</span>}
                  {step.status === "active" && <span className="hf-spinner hf-icon-xs" />}
                  {step.status === "pending" && <span style={{ width: 14, display: "inline-block" }}>○</span>}
                  {step.status === "error" && <span style={{ color: "var(--status-error-text)", fontSize: 14 }}>✗</span>}
                  <span className={`hf-text-sm ${step.status === "done" ? "hf-text-muted" : ""}`}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          )}

          {commitTimeline.length === 0 && (
            <div className="hf-flex hf-justify-center hf-mb-lg">
              <div className="hf-spinner hf-icon-xl hf-spinner-thick" />
            </div>
          )}
        </div>

        <div className="hf-step-footer">
          <button type="button" onClick={handleCancelCommit} className="hf-btn hf-btn-ghost">
            Cancel
          </button>
          <button type="button" disabled className="hf-btn hf-btn-primary" style={{ opacity: 0.6 }}>
            <span className="hf-spinner hf-icon-xs" style={{ marginRight: 6 }} />
            Creating…
          </button>
        </div>
      </div>
    );
  }

  // ── Error ──
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

  // ── Review (pre-launch) ──
  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">
        <WizardSummary
          title={`Launch ${institutionName || "Institution"}`}
          subtitle="Review your details and launch when ready."
          intent={{
            items: [
              { icon: <Building2 className="hf-icon-sm" />, label: "Name", value: institutionName || "—" },
              ...(typeSlug ? [{ label: "Type", value: typeSlug }] : []),
              ...(primaryColor ? [{ label: "Branding", value: "Custom colours set" }] : []),
              ...(welcomeMessage
                ? [{ label: "Welcome", value: `${welcomeMessage.slice(0, 60)}${welcomeMessage.length > 60 ? "…" : ""}` }]
                : []),
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
