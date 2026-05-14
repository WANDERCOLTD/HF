"use client";

import { useEffect, useState, Suspense } from "react";
import { GraduationCap, School, Building2 } from "lucide-react";
import { useTerminology } from "@/contexts/TerminologyContext";
import { useStudentCallerId } from "@/hooks/useStudentCallerId";

interface TeacherData {
  teacher: {
    name: string;
    email: string | null;
  };
  classroom: string;
  classrooms?: Array<{ id: string; name: string; teacher: string }>;
  domain: string;
  institution: {
    name: string;
    logo: string | null;
  } | null;
}

export default function StudentTeacherPage() {
  return (
    <Suspense fallback={<div className="p-6"><div className="animate-pulse h-8 w-40 rounded bg-[var(--surface-secondary)]" /></div>}>
      <StudentTeacherContent />
    </Suspense>
  );
}

function StudentTeacherContent() {
  const { isAdmin, hasSelection, buildUrl } = useStudentCallerId();
  const [data, setData] = useState<TeacherData | null>(null);
  const [loading, setLoading] = useState(true);
  const { terms } = useTerminology();

  useEffect(() => {
    if (isAdmin && !hasSelection) { setLoading(false); return; }
    fetch(buildUrl("/api/student/teacher"))
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setData(d);
      })
      .finally(() => setLoading(false));
  }, [isAdmin, hasSelection, buildUrl]);

  if (isAdmin && !hasSelection) {
    return (
      <div className="p-6">
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
          Open this page from a learner&apos;s profile to view their teacher information.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-40 rounded bg-[var(--surface-secondary)]" />
          <div className="h-48 rounded-lg bg-[var(--surface-secondary)]" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <p style={{ color: "var(--text-muted)" }}>Unable to load teacher information.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
        {terms.instructor}
      </h1>

      <div className="space-y-4">
        {/* Teacher card */}
        <div
          className="rounded-lg border p-5"
          style={{
            borderColor: "var(--border-default)",
            background: "var(--surface-primary)",
          }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: "color-mix(in srgb, var(--status-success-text) 15%, transparent)" }}
            >
              <GraduationCap size={20} style={{ color: "var(--status-success-text)" }} />
            </div>
            <div>
              <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {data.teacher.name}
              </p>
              {data.teacher.email && (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {data.teacher.email}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Classroom info */}
        <div
          className="rounded-lg border p-5"
          style={{
            borderColor: "var(--border-default)",
            background: "var(--surface-primary)",
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <School size={14} style={{ color: "var(--text-muted)" }} />
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              {terms.cohort}
            </span>
          </div>
          <p className="font-medium" style={{ color: "var(--text-primary)" }}>
            {data.classroom}
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
            {data.domain}
          </p>
        </div>

        {/* Institution (if any) */}
        {data.institution && (
          <div
            className="rounded-lg border p-5"
            style={{
              borderColor: "var(--border-default)",
              background: "var(--surface-primary)",
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Building2 size={14} style={{ color: "var(--text-muted)" }} />
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                {terms.domain}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {data.institution.logo && (
                <img
                  src={data.institution.logo}
                  alt={data.institution.name}
                  className="h-8 object-contain"
                />
              )}
              <p className="font-medium" style={{ color: "var(--text-primary)" }}>
                {data.institution.name}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
