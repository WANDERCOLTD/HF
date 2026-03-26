"use client";

/**
 * RefPreviewPanel — Live preview of the course reference document.
 *
 * Shows section checklist with progress indicators and
 * expanding detail for completed/in-progress sections.
 *
 * Styled to match the ScaffoldPanel from GS V5 (CSS vars, no Tailwind).
 */

import { useMemo } from "react";
import { Check, Circle, Loader2 } from "lucide-react";
import type { CourseRefData } from "@/lib/content-trust/course-ref-to-assertions";

interface RefPreviewPanelProps {
  refData: CourseRefData;
}

interface SectionInfo {
  key: string;
  label: string;
  status: "complete" | "partial" | "empty";
  mandatory: boolean;
}

function evaluatePreviewSections(data: CourseRefData): SectionInfo[] {
  return [
    {
      key: "courseOverview",
      label: "Course Overview",
      status: data.courseOverview?.subject ? "complete" : data.courseOverview ? "partial" : "empty",
      mandatory: false,
    },
    {
      key: "learningOutcomes",
      label: "Learning Outcomes",
      status: data.learningOutcomes?.skillOutcomes?.length ? "complete" : "empty",
      mandatory: false,
    },
    {
      key: "skillsFramework",
      label: "Skills Framework",
      status: data.skillsFramework?.length
        ? data.skillsFramework.every((s) => s.tiers?.emerging) ? "complete" : "partial"
        : "empty",
      mandatory: true,
    },
    {
      key: "teachingApproach",
      label: "Teaching Approach",
      status: data.teachingApproach?.corePrinciples?.length
        ? (data.teachingApproach.corePrinciples.length >= 2 ? "complete" : "partial")
        : "empty",
      mandatory: true,
    },
    {
      key: "coursePhases",
      label: "Course Phases",
      status: data.coursePhases?.length ? "complete" : "empty",
      mandatory: false,
    },
    {
      key: "edgeCases",
      label: "Edge Cases",
      status: data.edgeCases?.length
        ? (data.edgeCases.length >= 2 ? "complete" : "partial")
        : "empty",
      mandatory: true,
    },
    {
      key: "communicationRules",
      label: "Communication",
      status: data.communicationRules?.toStudent?.tone ? "complete" : "empty",
      mandatory: false,
    },
    {
      key: "assessmentBoundaries",
      label: "Assessment",
      status: data.assessmentBoundaries?.length ? "complete" : "empty",
      mandatory: false,
    },
    {
      key: "metrics",
      label: "Metrics",
      status: data.metrics?.length ? "complete" : "empty",
      mandatory: false,
    },
  ];
}

function StatusIcon({ status }: { status: SectionInfo["status"] }) {
  switch (status) {
    case "complete":
      return <Check size={16} style={{ color: "var(--status-success-text)" }} />;
    case "partial":
      return <Loader2 size={16} style={{ color: "var(--status-warning-text)" }} />;
    case "empty":
      return <Circle size={16} style={{ color: "var(--text-muted)", opacity: 0.35 }} />;
  }
}

export function RefPreviewPanel({ refData }: RefPreviewPanelProps) {
  const sections = useMemo(() => evaluatePreviewSections(refData), [refData]);
  const complete = sections.filter((s) => s.status === "complete").length;
  const total = sections.length;

  return (
    <div className="gs-scaffold" style={{ margin: 0, borderRadius: 0, border: "none", borderLeft: "1px solid var(--border-default)" }}>
      {/* Header + Progress */}
      <div style={{ marginBottom: 16 }}>
        <div className="gs-bp-title" style={{ fontSize: 14 }}>Course Reference</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <div style={{
            flex: 1,
            height: 6,
            borderRadius: 3,
            background: "var(--border-default)",
            overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              borderRadius: 3,
              background: "var(--accent-primary)",
              transition: "width 0.3s ease",
              width: `${(complete / total) * 100}%`,
            }} />
          </div>
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
            {complete}/{total}
          </span>
        </div>
      </div>

      {/* Section Checklist */}
      <div className="gs-bp-body">
        {sections.map((s) => (
          <div
            key={s.key}
            className="gs-bp-section"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "default",
              background: s.status !== "empty"
                ? "color-mix(in srgb, var(--accent-primary) 4%, transparent)"
                : "transparent",
            }}
          >
            <StatusIcon status={s.status} />
            <span style={{
              fontSize: 13,
              color: s.status === "empty" ? "var(--text-muted)" : "var(--text-primary)",
              fontWeight: s.status !== "empty" ? 500 : 400,
              flex: 1,
            }}>
              {s.label}
            </span>
            {s.mandatory && s.status !== "complete" && (
              <span style={{
                fontSize: 10,
                color: "var(--status-warning-text)",
                fontWeight: 600,
              }}>
                required
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Section Details */}
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Skills Framework */}
        {refData.skillsFramework?.length ? (
          <SectionDetail title="Skills Framework">
            {refData.skillsFramework.map((skill) => (
              <div key={skill.id} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>
                  {skill.id}: {skill.name}
                </div>
                {skill.tiers && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", paddingLeft: 8, marginTop: 2 }}>
                    {skill.tiers.emerging && <div>E: {skill.tiers.emerging}</div>}
                    {skill.tiers.developing && <div>D: {skill.tiers.developing}</div>}
                    {skill.tiers.secure && <div>S: {skill.tiers.secure}</div>}
                  </div>
                )}
              </div>
            ))}
          </SectionDetail>
        ) : null}

        {/* Teaching Approach */}
        {refData.teachingApproach?.corePrinciples?.length ? (
          <SectionDetail title="Teaching Rules">
            {refData.teachingApproach.corePrinciples.map((p, i) => (
              <div key={i} style={{ fontSize: 11, color: "var(--text-muted)" }}>• {p}</div>
            ))}
          </SectionDetail>
        ) : null}

        {/* Session Structure */}
        {refData.teachingApproach?.sessionStructure?.phases?.length ? (
          <SectionDetail title="Session Structure">
            {refData.teachingApproach.sessionStructure.phases.map((p, i) => (
              <div key={i} style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {p.name}{p.duration ? ` (${p.duration})` : ""}
              </div>
            ))}
          </SectionDetail>
        ) : null}

        {/* Edge Cases */}
        {refData.edgeCases?.length ? (
          <SectionDetail title="Edge Cases">
            {refData.edgeCases.map((ec, i) => (
              <div key={i} style={{ fontSize: 11, color: "var(--text-muted)" }}>
                <strong>{ec.scenario}:</strong> {ec.response}
              </div>
            ))}
          </SectionDetail>
        ) : null}

        {/* Course Phases */}
        {refData.coursePhases?.length ? (
          <SectionDetail title="Course Phases">
            {refData.coursePhases.map((p, i) => (
              <div key={i}>
                <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>{p.name}</div>
                {p.goal && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.goal}</div>}
              </div>
            ))}
          </SectionDetail>
        ) : null}
      </div>
    </div>
  );
}

function SectionDetail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      borderTop: "1px solid var(--border-default)",
      paddingTop: 10,
    }}>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase" as const,
        letterSpacing: "0.05em",
        color: "var(--text-muted)",
        marginBottom: 6,
      }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{children}</div>
    </div>
  );
}
