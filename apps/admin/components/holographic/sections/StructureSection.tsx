"use client";

/**
 * Structure Section — Playbooks (courses), caller counts, spec items.
 * Read-only view of the domain's course structure.
 */

import { useHolo } from "@/hooks/useHolographicState";
import { BookOpen, Users, Layers, ArrowUpRight } from "lucide-react";
import Link from "next/link";

interface PlaybookData {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  config?: Record<string, unknown> | null;
  _count?: { items: number; enrollments: number };
}

export function StructureSection() {
  const { state } = useHolo();
  const domain = state.domainDetail as Record<string, any> | null;

  if (!domain) {
    return <div className="hp-section-empty">No domain data loaded.</div>;
  }

  const playbooks: PlaybookData[] = domain.playbooks || [];
  const callerCount = domain._count?.callers ?? domain.callers?.length ?? 0;

  if (playbooks.length === 0) {
    return (
      <div className="hp-section-empty">
        <BookOpen size={24} className="hp-section-empty-icon" />
        <div>No courses yet.</div>
        <div className="hp-section-empty-hint">
          Use the Teach wizard to create a course for this domain.
        </div>
      </div>
    );
  }

  return (
    <div className="hp-section-structure">
      {/* Overview stats */}
      <div className="hp-stat-row">
        <div className="hp-stat-chip">
          <BookOpen size={14} />
          {playbooks.length} course{playbooks.length !== 1 ? "s" : ""}
        </div>
        <div className="hp-stat-chip">
          <Users size={14} />
          {callerCount} caller{callerCount !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Playbook list */}
      <div className="hp-playbook-list">
        {playbooks.map((pb) => {
          const discipline = (pb.config as any)?.subjectDiscipline;
          const mode = (pb.config as any)?.teachingMode;
          return (
            <div key={pb.id} className="hp-playbook-card">
              <div className="hp-playbook-header">
                <span className="hp-playbook-name">{pb.name}</span>
                <Link
                  href={`/x/courses/${pb.id}`}
                  className="hp-playbook-link"
                  title="Open course"
                >
                  <ArrowUpRight size={14} />
                </Link>
              </div>
              {pb.description && (
                <div className="hp-playbook-desc">{pb.description}</div>
              )}
              <div className="hp-playbook-meta">
                <span className={`hp-status-chip hp-status-${pb.status.toLowerCase()}`}>
                  {pb.status}
                </span>
                {discipline && (
                  <span className="hp-meta-tag">{discipline}</span>
                )}
                {mode && (
                  <span className="hp-meta-tag">{mode}</span>
                )}
                <span className="hp-meta-tag">
                  <Layers size={11} />
                  {pb._count?.items ?? 0} specs
                </span>
                <span className="hp-meta-tag">
                  <Users size={11} />
                  {pb._count?.enrollments ?? 0} enrolled
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
