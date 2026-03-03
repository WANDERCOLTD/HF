"use client";

/**
 * Step 3: Your Content
 *
 * Wraps PackUploadStep — multi-file upload with AI classification + extraction.
 * Eager domain creation: if no domainId exists (new institution), creates
 * institution + domain on mount so the upload area is always available.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, Check } from "lucide-react";
import slugify from "slugify";
import { PackUploadStep } from "@/components/wizards/PackUploadStep";
import type { PackUploadResult } from "@/components/wizards/PackUploadStep";
import { ExtractionSummary } from "@/components/shared/ExtractionSummary";
import { StepFooter } from "@/components/wizards/StepFooter";
import type { StepRenderProps } from "@/components/wizards/types";

interface TimelineItem {
  label: string;
  status: "pending" | "active" | "done" | "error";
}

export function ContentStep({ getData, setData, onNext, onPrev }: StepRenderProps) {
  const domainId = getData<string>("existingDomainId") || getData<string>("draftDomainId") || "";
  const courseName = getData<string>("courseName") || "";
  const interactionPattern = getData<string>("interactionPattern");
  const teachingMode = getData<string>("teachingMode");
  const subjectDiscipline = getData<string>("subjectDiscipline");

  // ── Extraction summary state ──
  const [uploadResult, setUploadResult] = useState<PackUploadResult | null>(null);

  // ── Eager creation state ──
  const [creationPhase, setCreationPhase] = useState<"creating" | "done" | "error" | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [eagerDomainId, setEagerDomainId] = useState<string | null>(null);
  const creationStarted = useRef(false);

  const effectiveDomainId = domainId || eagerDomainId || "";

  // ── Eager creation: create institution + domain if needed ──
  useEffect(() => {
    if (domainId || creationStarted.current) return;
    const institutionName = getData<string>("institutionName");
    if (!institutionName) return; // No new institution to create

    creationStarted.current = true;

    const createInstitution = async () => {
      setCreationPhase("creating");
      const steps: TimelineItem[] = [
        { label: "Creating organisation", status: "active" },
        { label: "Setting up workspace", status: "pending" },
        { label: "Ready for content", status: "pending" },
      ];
      setTimeline([...steps]);

      try {
        const res = await fetch("/api/institutions/launch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            institutionName,
            slug: slugify(institutionName, { lower: true, strict: true }),
            typeSlug: getData<string>("typeSlug"),
            typeId: getData<string>("typeId"),
            websiteUrl: getData<string>("websiteUrl"),
            logoUrl: getData<string>("logoUrl"),
            primaryColor: getData<string>("primaryColor"),
            secondaryColor: getData<string>("secondaryColor"),
          }),
        });

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";
        let completed = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() || "";

          for (const block of blocks) {
            const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            try {
              const event = JSON.parse(dataLine.slice(6));
              if (event.phase === "creating-institution") {
                steps[0] = { ...steps[0], status: "active" };
                setTimeline([...steps]);
              }
              if (event.phase === "creating-domain" || event.phase === "scaffolding") {
                steps[0] = { ...steps[0], status: "done" };
                steps[1] = { ...steps[1], status: "active" };
                setTimeline([...steps]);
              }
              if (event.phase === "linking-user") {
                steps[1] = { ...steps[1], status: "done" };
                steps[2] = { ...steps[2], status: "active" };
                setTimeline([...steps]);
              }
              if (event.phase === "complete" && event.detail) {
                steps[0] = { ...steps[0], status: "done" };
                steps[1] = { ...steps[1], status: "done" };
                steps[2] = { ...steps[2], status: "done" };
                setTimeline([...steps]);
                setData("draftDomainId", event.detail.domainId);
                setData("draftInstitutionId", event.detail.institutionId);
                setEagerDomainId(event.detail.domainId as string);
                setCreationPhase("done");
                completed = true;
              }
              if (event.phase === "error") {
                throw new Error(event.message || "Creation failed");
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }

        // Flush remaining buffer
        if (!completed && buffer.trim()) {
          const dataLine = buffer.split("\n").find((l) => l.startsWith("data: "));
          if (dataLine) {
            try {
              const event = JSON.parse(dataLine.slice(6));
              if (event.phase === "complete" && event.detail) {
                setData("draftDomainId", event.detail.domainId);
                setData("draftInstitutionId", event.detail.institutionId);
                setEagerDomainId(event.detail.domainId as string);
                setCreationPhase("done");
                completed = true;
              }
            } catch { /* ignore */ }
          }
        }

        if (!completed) throw new Error("Institution creation did not complete");
      } catch (err: any) {
        setCreationError(err.message || "Something went wrong");
        setCreationPhase("error");
        const updated = timeline.length > 0
          ? timeline.map((t) => t.status === "active" ? { ...t, status: "error" as const } : t)
          : steps.map((t) => t.status === "active" ? { ...t, status: "error" as const } : t);
        setTimeline(updated);
      }
    };

    const steps: TimelineItem[] = [
      { label: "Creating organisation", status: "active" },
      { label: "Setting up workspace", status: "pending" },
      { label: "Ready for content", status: "pending" },
    ];

    createInstitution();
  }, [domainId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExtractionProgress = useCallback((totals: { assertions: number; questions: number; vocabulary: number; images: number }, isIngesting: boolean) => {
    setData("extractionProgress", isIngesting ? totals : null);
  }, [setData]);

  const handleResult = (result: PackUploadResult) => {
    if (result.mode === "skip") {
      setData("contentSkipped", true);
      onNext();
      return;
    }
    // Store data in wizard bag
    setData("contentSkipped", false);
    if (result.subjects) setData("packSubjectIds", result.subjects.map((s) => s.id));
    if (result.sourceCount) setData("sourceCount", result.sourceCount);
    if (result.extractionTotals) setData("extractionTotals", result.extractionTotals);
    if (result.classifications) setData("classifications", result.classifications);
    if (result.categoryCounts) setData("categoryCounts", result.categoryCounts);
    // Show extraction summary instead of auto-advancing
    setUploadResult(result);
  };

  const handleRetry = () => {
    creationStarted.current = false;
    setCreationPhase(null);
    setCreationError(null);
    setTimeline([]);
    // Trigger re-run of the effect
    setEagerDomainId(null);
  };

  // ── Creating: show timeline ──
  if (!effectiveDomainId && (creationPhase === "creating" || creationPhase === "error")) {
    return (
      <div className="hf-wizard-page">
        <div className="hf-wizard-step">
          <div className="hf-mb-lg">
            <h1 className="hf-page-title hf-mb-xs">Setting up your organisation</h1>
            <p className="hf-page-subtitle">
              {getData<string>("institutionName") || "Your organisation"}
            </p>
          </div>

          <div className="hf-mb-lg" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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

          {creationError && (
            <div className="hf-banner hf-banner-error hf-mt-lg">
              {creationError}
            </div>
          )}
        </div>
        <StepFooter
          onBack={onPrev}
          onNext={creationPhase === "error" ? handleRetry : () => {}}
          nextLabel={creationPhase === "error" ? "Retry" : "Setting up..."}
          nextDisabled={creationPhase === "creating"}
        />
      </div>
    );
  }

  // ── Extraction complete: show summary ──
  if (effectiveDomainId && uploadResult) {
    return (
      <div className="hf-wizard-page">
        <div className="hf-wizard-step">
          <ExtractionSummary
            result={uploadResult}
            onContinue={onNext}
            onReUpload={() => setUploadResult(null)}
          />
        </div>
      </div>
    );
  }

  // ── Ready: show PackUploadStep ──
  if (effectiveDomainId) {
    return (
      <div className="hf-wizard-page">
        <div className="hf-wizard-step">
          <div className="hf-mb-lg">
            <h1 className="hf-page-title hf-mb-xs">Your content</h1>
            <p className="hf-page-subtitle">
              Upload your teaching materials. The AI will classify each file and extract
              teaching points automatically.
            </p>
          </div>

          <PackUploadStep
            domainId={effectiveDomainId}
            courseName={courseName}
            interactionPattern={interactionPattern}
            teachingMode={teachingMode}
            subjectDiscipline={subjectDiscipline}
            onResult={handleResult}
            onProgress={handleExtractionProgress}
            onBack={onPrev}
          />
        </div>
      </div>
    );
  }

  // ── Fallback: no domain, no institution name (shouldn't happen) ──
  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">
        <div className="hf-mb-lg">
          <h1 className="hf-page-title hf-mb-xs">Your content</h1>
          <p className="hf-page-subtitle">
            Upload your teaching materials — PDFs, Word documents, or text files.
            The AI will extract teaching points and build a knowledge base.
          </p>
        </div>
        <div className="hf-banner hf-banner-info hf-mb-lg">
          Content will be processed when you create your course. You can add files now or skip and add them later.
        </div>
      </div>
      <StepFooter
        onBack={onPrev}
        onNext={() => {
          setData("contentSkipped", true);
          onNext();
        }}
        nextLabel="Skip for now"
        secondaryAction={{
          label: "Continue without content",
          onClick: () => {
            setData("contentSkipped", true);
            onNext();
          },
        }}
      />
    </div>
  );
}
