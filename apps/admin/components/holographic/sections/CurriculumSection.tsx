"use client";

/**
 * Curriculum Section — Subjects, content sources, assertion counts.
 * Shows what the domain teaches and content extraction status.
 */

import { useHolo } from "@/hooks/useHolographicState";
import { BookOpen, FileText, ArrowUpRight, Database } from "lucide-react";
import Link from "next/link";

interface SubjectSource {
  source: {
    id: string;
    slug: string;
    name: string;
    trustLevel: number;
    _count: { assertions: number };
  };
}

interface SubjectData {
  subject: {
    id: string;
    name: string;
    slug?: string;
    sources: SubjectSource[];
    _count?: { sources: number };
  };
}

export function CurriculumSection() {
  const { state } = useHolo();
  const domain = state.domainDetail as Record<string, any> | null;

  if (!domain) {
    return <div className="hp-section-empty">No domain data loaded.</div>;
  }

  const subjects: SubjectData[] = domain.subjects || [];

  if (subjects.length === 0) {
    return (
      <div className="hp-section-empty">
        <BookOpen size={24} className="hp-section-empty-icon" />
        <div>No subjects configured.</div>
        <div className="hp-section-empty-hint">
          Add subjects via the Library or Teach wizard.
        </div>
      </div>
    );
  }

  return (
    <div className="hp-section-curriculum">
      {subjects.map((ds) => {
        const sub = ds.subject;
        const totalAssertions = sub.sources.reduce(
          (sum, ss) => sum + (ss.source._count?.assertions ?? 0),
          0,
        );

        return (
          <div key={sub.id} className="hp-subject-card">
            <div className="hp-subject-header">
              <BookOpen size={16} className="hp-subject-icon" />
              <span className="hp-subject-name">{sub.name}</span>
              <Link
                href={`/x/subjects`}
                className="hp-section-link-sm"
                title="View subjects"
              >
                <ArrowUpRight size={12} />
              </Link>
            </div>

            {/* Content sources */}
            {sub.sources.length > 0 ? (
              <div className="hp-source-list">
                {sub.sources.map((ss) => (
                  <div key={ss.source.id} className="hp-source-row">
                    <FileText size={13} className="hp-source-icon" />
                    <span className="hp-source-name">{ss.source.name}</span>
                    <span className="hp-source-meta">
                      L{ss.source.trustLevel}
                    </span>
                    <span className="hp-source-meta">
                      <Database size={10} />
                      {ss.source._count.assertions}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="hp-source-empty">No content sources</div>
            )}

            {/* Totals */}
            <div className="hp-subject-footer">
              {sub._count?.sources ?? sub.sources.length} source{(sub._count?.sources ?? sub.sources.length) !== 1 ? "s" : ""}
              {" · "}
              {totalAssertions} teaching point{totalAssertions !== 1 ? "s" : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}
