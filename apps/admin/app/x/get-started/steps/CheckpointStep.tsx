"use client";

/**
 * Step 4: Ready to Test — Break Point
 *
 * Offers two paths:
 * - "Create & Try Call" — creates course (domain already exists from ContentStep), sim call works immediately
 * - "Continue Setup" — advances to step 5 without creating
 */

import { useState } from "react";
import slugify from "slugify";
import { Loader2, Check, Rocket, ArrowRight } from "lucide-react";
import { StepFooter } from "@/components/wizards/StepFooter";
import type { StepRenderProps } from "@/components/wizards/types";

type Phase = "idle" | "creating" | "done" | "error";

interface TimelineItem {
  label: string;
  status: "pending" | "active" | "done" | "error";
}

export function CheckpointStep({ getData, setData, onNext, onPrev }: StepRenderProps) {
  const [phase, setPhase] = useState<Phase>(getData<string>("draftPlaybookId") ? "done" : "idle");
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const institutionName = getData<string>("institutionName") || getData<string>("existingInstitutionName") || "Your organisation";
  const courseName = getData<string>("courseName") || "Your course";
  const hasContent = !!(getData<string[]>("packSubjectIds")?.length || getData<string>("sourceId"));
  const contentSkipped = getData<boolean>("contentSkipped");
  const extractionTotals = getData<{ assertions: number }>("extractionTotals");

  const handleCreateAndTry = async () => {
    setPhase("creating");
    setError(null);

    // Determine domain source: eager-created (draftDomainId), existing, or needs creation
    const isExisting = !!getData<string>("existingInstitutionId");
    const hasDraftDomain = !!getData<string>("draftDomainId");

    const steps: TimelineItem[] = [
      {
        label: hasDraftDomain || isExisting ? "Using existing organisation" : "Creating organisation",
        status: hasDraftDomain || isExisting ? "done" : "active",
      },
      { label: "Setting up course", status: hasDraftDomain || isExisting ? "active" : "pending" },
      { label: "Scaffolding AI tutor", status: "pending" },
      { label: "Composing first prompt", status: "pending" },
    ];
    setTimeline([...steps]);

    try {
      let domainId: string;
      let institutionId: string | undefined;

      if (hasDraftDomain) {
        // Domain already created eagerly at ContentStep
        domainId = getData<string>("draftDomainId") || "";
        institutionId = getData<string>("draftInstitutionId") || undefined;
      } else if (isExisting) {
        domainId = getData<string>("existingDomainId") || "";
        institutionId = getData<string>("existingInstitutionId") || undefined;
      } else {
        // Fallback: create institution + domain (shouldn't normally happen with eager creation)
        const instName = getData<string>("institutionName") || "";
        const launchRes = await fetch("/api/institutions/launch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            institutionName: instName,
            slug: slugify(instName, { lower: true, strict: true }),
            typeSlug: getData<string>("typeSlug"),
            typeId: getData<string>("typeId"),
            websiteUrl: getData<string>("websiteUrl"),
            logoUrl: getData<string>("logoUrl"),
            primaryColor: getData<string>("primaryColor"),
            secondaryColor: getData<string>("secondaryColor"),
          }),
        });

        const reader = launchRes.body?.getReader();
        const decoder = new TextDecoder();
        let result = { institutionId: "", domainId: "" };

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            const lines = text.split("\n").filter((l) => l.startsWith("data: "));
            for (const line of lines) {
              try {
                const event = JSON.parse(line.slice(6));
                if (event.phase === "complete" && event.detail) {
                  result = event.detail;
                }
              } catch {
                // Skip malformed lines
              }
            }
          }
        }

        if (!result.domainId) {
          throw new Error("Failed to create institution");
        }

        domainId = result.domainId;
        institutionId = result.institutionId;
        steps[0] = { ...steps[0], status: "done" };
        setTimeline([...steps]);
      }

      // Create course via courseSetup
      steps[1] = { ...steps[1], status: "active" };
      setTimeline([...steps]);

      const setupRes = await fetch("/api/courses/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseName: getData<string>("courseName"),
          domainId,
          interactionPattern: getData<string>("interactionPattern"),
          teachingMode: getData<string>("teachingMode"),
          subjectDiscipline: getData<string>("subjectDiscipline"),
          packSubjectIds: getData<string[]>("packSubjectIds"),
          sourceId: getData<string>("sourceId"),
          learningOutcomes: [],
          teachingStyle: getData<string>("interactionPattern") || "socratic",
          sessionCount: 5,
          durationMins: 30,
          emphasis: "balanced",
          welcomeMessage: "",
          studentEmails: [],
        }),
      });

      const setupData = await setupRes.json();
      if (!setupData.ok) throw new Error(setupData.error || "Failed to set up course");

      // Poll the course setup task until complete so we get the playbookId
      const taskId = setupData.taskId;
      let playbookId: string | undefined;
      if (taskId) {
        const POLL_MS = 1500;
        const TIMEOUT_MS = 60_000;
        const start = Date.now();
        while (Date.now() - start < TIMEOUT_MS) {
          await new Promise((r) => setTimeout(r, POLL_MS));
          try {
            const taskRes = await fetch(`/api/tasks?taskId=${taskId}`);
            if (!taskRes.ok) continue;
            const taskData = await taskRes.json();
            const task = taskData.task || taskData.tasks?.[0] || taskData.guidance?.task;
            if (task?.status === "completed") {
              playbookId = task.context?.summary?.playbook?.id;
              break;
            }
            if (task?.status === "abandoned" || task?.context?.error) break;
          } catch { /* keep polling */ }
        }
      }

      steps[1] = { ...steps[1], status: "done" };
      steps[2] = { ...steps[2], status: "done" };
      steps[3] = { ...steps[3], status: "done" };
      setTimeline([...steps]);

      // Store results in data bag for later steps
      setData("draftDomainId", domainId);
      if (playbookId) setData("draftPlaybookId", playbookId);
      if (institutionId) setData("draftInstitutionId", institutionId);

      // Create a test caller enrolled in the specific course — only if we got the playbookId.
      // Without it, enrollCallerInDomainPlaybooks would enrol in ALL domain playbooks (wrong course).
      if (playbookId) {
        try {
          const FRIENDLY_NAMES = [
            "Alex", "Jordan", "Sam", "Taylor", "Morgan",
            "Riley", "Casey", "Jamie", "Quinn", "Avery",
            "Charlie", "Reese", "Skyler", "Finley", "Rowan",
          ];
          const simName = FRIENDLY_NAMES[Math.floor(Math.random() * FRIENDLY_NAMES.length)];
          const callerRes = await fetch("/api/callers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domainId, name: simName, playbookId }),
          });
          const callerData = await callerRes.json();
          if (callerData.ok && callerData.caller?.id) {
            setData("draftCallerId", callerData.caller.id);
          }
        } catch {
          // Non-fatal — sim link just won't show
        }
      }

      setPhase("done");
    } catch (err: any) {
      setError(err.message || "Something went wrong");
      setPhase("error");
      const updated = timeline.map((t) =>
        t.status === "active" ? { ...t, status: "error" as const } : t,
      );
      setTimeline(updated);
    }
  };

  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">
        {phase === "idle" && (
          <>
            <div className="hf-mb-lg">
              <h1 className="hf-page-title hf-mb-xs">
                <Rocket size={20} style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }} />
                Ready to test
              </h1>
              <p className="hf-page-subtitle">
                {institutionName} + {courseName}
                {extractionTotals ? ` + ${extractionTotals.assertions} teaching points` : ""}
              </p>
            </div>

            {!hasContent && !contentSkipped && (
              <div className="hf-banner hf-banner-warning hf-mb-lg">
                No content uploaded yet. The AI will use a generic prompt without subject-specific teaching points.
              </div>
            )}

            <div className="hf-card hf-mb-lg" style={{ padding: 20 }}>
              <p style={{ margin: 0, color: "var(--text-primary)", lineHeight: 1.6 }}>
                The AI tutor can already hold a conversation
                {hasContent ? " about your subject using the content you uploaded" : ""}.
                You can create it now and try a sim call, or continue setting up.
              </p>
            </div>

            <div className="hf-mb-lg" style={{ display: "flex", gap: 12 }}>
              <button
                type="button"
                className="hf-btn hf-btn-primary"
                onClick={handleCreateAndTry}
                style={{ flex: 1 }}
              >
                <Rocket size={16} />
                Create &amp; Try a Call
              </button>
              <button
                type="button"
                className="hf-btn hf-btn-secondary"
                onClick={onNext}
                style={{ flex: 1 }}
              >
                Continue Setup
                <ArrowRight size={16} />
              </button>
            </div>

            <p className="hf-text-sm hf-text-muted">
              Continuing adds: welcome message, session plan, tutor personality.
            </p>
          </>
        )}

        {(phase === "creating" || phase === "error") && (
          <>
            <div className="hf-mb-lg">
              <h1 className="hf-page-title hf-mb-xs">Setting up your course</h1>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {timeline.map((item, i) => (
                <div key={i} className="hf-flex hf-items-center hf-gap-sm">
                  {item.status === "done" && <Check size={16} style={{ color: "var(--status-success-text)" }} />}
                  {item.status === "active" && <Loader2 size={16} className="hf-spinner" />}
                  {item.status === "pending" && <div className="gs-timeline-pending" />}
                  {item.status === "error" && <div className="gs-timeline-error" />}
                  <span style={{ color: item.status === "pending" ? "var(--text-muted)" : "var(--text-primary)" }}>
                    {item.label}
                  </span>
                </div>
              ))}
            </div>

            {error && (
              <div className="hf-banner hf-banner-error hf-mt-lg">
                {error}
                <button
                  type="button"
                  className="hf-btn hf-btn-secondary hf-mt-sm"
                  onClick={handleCreateAndTry}
                >
                  Retry
                </button>
              </div>
            )}
          </>
        )}

        {phase === "done" && (
          <>
            <div className="hf-mb-lg">
              <h1 className="hf-page-title hf-mb-xs">
                <Check size={20} style={{ display: "inline", verticalAlign: "middle", marginRight: 8, color: "var(--status-success-text)" }} />
                Course created
              </h1>
              <p className="hf-page-subtitle">Your AI tutor is ready to test.</p>
            </div>

            <div className="hf-mb-lg" style={{ display: "flex", gap: 12 }}>
              <a
                href={`/x/sim/${getData<string>("draftCallerId") || ""}`}
                className="hf-btn hf-btn-primary"
                style={{ flex: 1, textAlign: "center" }}
              >
                Try a Sim Call
              </a>
            </div>

            <StepFooter
              onBack={onPrev}
              onNext={onNext}
              nextLabel="Continue Setup"
            />
          </>
        )}
      </div>
    </div>
  );
}
