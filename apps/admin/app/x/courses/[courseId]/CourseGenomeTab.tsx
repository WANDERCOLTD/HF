"use client";

/**
 * CourseGenomeTab — fetches genome data and renders the GenomeBrowser.
 *
 * Self-contained: owns its own fetch, loading, error, and empty states.
 * The parent page just renders <CourseGenomeTab courseId={...} />.
 */

import { useState, useEffect } from "react";
import { GenomeBrowser } from "@/components/shared/GenomeBrowser";
import { AssertionDetailDrawer } from "@/components/shared/AssertionDetailDrawer";
import type { GenomeData } from "@/app/api/courses/[courseId]/genome/route";
import { Dna } from "lucide-react";

interface CourseGenomeTabProps {
  courseId: string;
}

export function CourseGenomeTab({ courseId }: CourseGenomeTabProps) {
  const [data, setData] = useState<GenomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAssertionId, setSelectedAssertionId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    fetch(`/api/courses/${courseId}/genome`)
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setData(res.data);
        } else {
          setError(res.error || "Failed to load genome data");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [courseId]);

  if (loading) {
    return (
      <div className="hf-card">
        <div className="hf-glow-active" style={{ minHeight: 200 }}>
          <div className="hf-empty">
            <Dna size={20} />
            <span>Loading course genome…</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="hf-card">
        <div className="hf-banner hf-banner-error">{error}</div>
      </div>
    );
  }

  if (!data || data.teachingSessionCount === 0) {
    return (
      <div className="hf-card">
        <div className="hf-empty">
          <Dna size={24} />
          <span>No lesson plan yet</span>
          <span className="hf-text-muted hf-text-xs">
            Generate a lesson plan on the Journey tab to see the course genome.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="hf-card" style={{ position: "relative" }}>
      <GenomeBrowser
        data={data}
        onAssertionClick={(id) => setSelectedAssertionId(id)}
        activeAssertionId={selectedAssertionId}
      />
      <AssertionDetailDrawer
        courseId={courseId}
        assertionId={selectedAssertionId}
        onClose={() => setSelectedAssertionId(null)}
        onNavigate={(id) => setSelectedAssertionId(id)}
      />
    </div>
  );
}
