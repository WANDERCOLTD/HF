"use client";

import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTerminology } from "@/contexts/TerminologyContext";
import { useSession } from "next-auth/react";
import { FancySelect } from "@/components/shared/FancySelect";
import "./classrooms.css";

interface Classroom {
  id: string;
  name: string;
  description: string | null;
  domain: { id: string; name: string; slug: string };
  group: { id: string; name: string; groupType: string } | null;
  memberCount: number;
  isActive: boolean;
  joinToken: string | null;
  lastActivity: string | null;
  createdAt: string;
}

export default function ClassroomsPage() {
  const searchParams = useSearchParams();
  const institutionId = searchParams.get("institutionId");
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState("");
  const { terms, plural, lower, lowerPlural } = useTerminology();

  const { data: session } = useSession();
  const isOperator = ["OPERATOR", "EDUCATOR", "ADMIN", "SUPERADMIN"].includes((session?.user?.role as string) || "");

  const handleArchive = async (id: string) => {
    setArchiving(true);
    setArchiveError(null);
    try {
      const res = await fetch(`/api/educator/classrooms/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to archive");
      setClassrooms((prev) => prev.map((c) => c.id === id ? { ...c, isActive: false } : c));
    } catch (err: any) {
      setArchiveError(err.message || "Failed to archive");
    } finally {
      setArchiving(false);
      setConfirmArchiveId(null);
    }
  };

  useEffect(() => {
    const instQuery = institutionId ? `?institutionId=${institutionId}` : "";
    fetch(`/api/educator/classrooms${instQuery}`)
      .then((r) => r.json())
      .then((res: { ok: boolean; classrooms: Classroom[] }) => {
        if (res?.ok) setClassrooms(res.classrooms);
      })
      .finally(() => setLoading(false));
  }, [institutionId]);

  const availableGroups = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const c of classrooms) {
      if (c.group) map.set(c.group.id, { id: c.group.id, name: c.group.name });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [classrooms]);

  const filteredClassrooms = useMemo(() => {
    if (!selectedGroup) return classrooms;
    return classrooms.filter((c) => c.group?.id === selectedGroup);
  }, [classrooms, selectedGroup]);

  if (loading) {
    return (
      <div className="cls-loading">
        <div className="cls-loading-text">Loading {lowerPlural("cohort")}...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="cls-header">
        <div>
          <h1 className="hf-page-title">
            {plural("cohort")}
          </h1>
          <div className="hf-flex hf-gap-sm hf-items-center">
            <p className="cls-subtitle">
              {filteredClassrooms.length} {filteredClassrooms.length !== 1 ? lowerPlural("cohort") : lower("cohort")}
            </p>
            {availableGroups.length > 0 && (
              <FancySelect
                value={selectedGroup}
                onChange={setSelectedGroup}
                placeholder={`All ${(terms.group || "Department").toLowerCase()}s`}
                clearable
                options={availableGroups.map((g) => ({ value: g.id, label: g.name }))}
                className="cls-select-group"
              />
            )}
          </div>
        </div>
        {isOperator && (
          <Link
            href="/x/educator/classrooms/new"
            className="hf-btn hf-btn-primary cls-link-btn"
          >
            + New {terms.cohort}
          </Link>
        )}
      </div>

      {archiveError && (
        <div className="hf-banner hf-banner-error cls-banner-row">
          <span>{archiveError}</span>
          <button
            onClick={() => setArchiveError(null)}
            className="hf-btn-ghost cls-dismiss-btn"
          >
            Dismiss
          </button>
        </div>
      )}

      {filteredClassrooms.length === 0 ? (
        <div className="hf-card text-center cls-empty">
          <div className="cls-empty-icon">👋</div>
          <h3 className="cls-empty-title">
            No {lowerPlural("cohort")} yet
          </h3>
          <p className="cls-empty-desc">
            Create your first {lower("cohort")} to start inviting {lowerPlural("caller")}.
          </p>
          {isOperator && (
            <Link
              href="/x/educator/classrooms/new"
              className="hf-btn hf-btn-primary cls-link-btn"
            >
              Create {terms.cohort}
            </Link>
          )}
        </div>
      ) : (
        <div className="cls-grid">
          {filteredClassrooms.map((classroom) => (
            <Link
              key={classroom.id}
              href={`/x/educator/classrooms/${classroom.id}`}
              className={`hf-card-compact home-stat-card flex flex-col cls-card ${classroom.isActive ? "cls-card-active" : "cls-card-archived"}`}
            >
              <div className="cls-card-header">
                <h3 className="cls-card-title">
                  {classroom.name}
                </h3>
                {!classroom.isActive && (
                  <span className="cls-archived-badge">
                    Archived
                  </span>
                )}
              </div>

              {classroom.description && (
                <p className="cls-card-desc">
                  {classroom.description}
                </p>
              )}

              <div className="cls-card-footer">
                <span>{classroom.memberCount} {classroom.memberCount !== 1 ? lowerPlural("caller") : lower("caller")}</span>
                <span className="cls-domain-badge">
                  {classroom.domain.name}
                </span>
                {classroom.group && (
                  <span className="hf-pill hf-pill-neutral">{classroom.group.name}</span>
                )}
              </div>

              {classroom.lastActivity && (
                <div className="cls-last-activity">
                  Last activity:{" "}
                  {new Date(classroom.lastActivity).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                  })}
                </div>
              )}

              {/* Archive action */}
              {isOperator && classroom.isActive && (
                <div
                  className="cls-archive-divider"
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                >
                  {confirmArchiveId === classroom.id ? (
                    <div className="cls-archive-confirm">
                      <span className="cls-archive-warn">Archive?</span>
                      <button
                        onClick={() => handleArchive(classroom.id)}
                        disabled={archiving}
                        className="hf-btn hf-btn-destructive cls-archive-btn"
                      >
                        {archiving ? "..." : "Yes"}
                      </button>
                      <button
                        onClick={() => setConfirmArchiveId(null)}
                        className="hf-btn hf-btn-secondary cls-archive-btn"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmArchiveId(classroom.id)}
                      className="hf-btn-ghost cls-archive-trigger"
                    >
                      Archive
                    </button>
                  )}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
