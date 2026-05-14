"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { Inbox, GraduationCap, Phone, ChevronDown, ChevronUp } from "lucide-react";
import { useStudentCallerId } from "@/hooks/useStudentCallerId";

interface Artifact {
  id: string;
  callId: string | null;
  type: string;
  title: string;
  content: string;
  mediaUrl: string | null;
  mediaType: string | null;
  trustLevel: string;
  confidence: number;
  status: string;
  channel: string;
  createdAt: string;
  readAt: string | null;
  createdBy: string | null;
  call: { createdAt: string } | null;
}

const TYPE_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  SUMMARY: { icon: "\u{1F4CB}", label: "Summary", color: "var(--status-success-text)" },
  KEY_FACT: { icon: "\u{1F4A1}", label: "Key Fact", color: "var(--badge-orange-text)" },
  FORMULA: { icon: "\u{1F9EE}", label: "Formula", color: "var(--badge-purple-text)" },
  EXERCISE: { icon: "\u{270F}\u{FE0F}", label: "Exercise", color: "var(--accent-primary)" },
  RESOURCE_LINK: { icon: "\u{1F4D6}", label: "Resource", color: "var(--badge-cyan-text)" },
  STUDY_NOTE: { icon: "\u{1F4DD}", label: "Study Note", color: "var(--badge-lime-text)" },
  REMINDER: { icon: "\u{23F0}", label: "Reminder", color: "var(--status-error-text)" },
  MEDIA: { icon: "\u{1F4CE}", label: "Media", color: "var(--text-secondary)" },
};

export default function StudentStuffPage() {
  return (
    <Suspense fallback={<div className="p-6"><div className="animate-pulse h-8 w-48 rounded bg-[var(--surface-secondary)]" /></div>}>
      <StudentStuffContent />
    </Suspense>
  );
}

function StudentStuffContent() {
  const { isAdmin, hasSelection, buildUrl } = useStudentCallerId();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ total: 0, unread: 0 });

  const fetchArtifacts = useCallback(async () => {
    if (isAdmin && !hasSelection) { setLoading(false); return; }
    try {
      const res = await fetch(buildUrl("/api/student/artifacts"));
      const data = await res.json();
      if (data.ok) {
        setArtifacts(data.artifacts);
        setCounts(data.counts);

        // Mark unread as read
        const unreadIds = data.artifacts
          .filter((a: Artifact) => a.status === "DELIVERED" || a.status === "SENT")
          .map((a: Artifact) => a.id);
        if (unreadIds.length > 0) {
          fetch(buildUrl("/api/student/artifacts/mark-read"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ artifactIds: unreadIds }),
          });
        }
      }
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  }, [isAdmin, hasSelection, buildUrl]);

  useEffect(() => {
    fetchArtifacts();
  }, [fetchArtifacts]);

  if (isAdmin && !hasSelection) {
    return (
      <div className="p-6">
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
          Open this page from a learner&apos;s profile to view their study materials.
        </p>
      </div>
    );
  }

  const teacherArtifacts = artifacts.filter((a) => a.callId === null);
  const sessionArtifacts = artifacts.filter((a) => a.callId !== null);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-[var(--surface-secondary)]" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-lg bg-[var(--surface-secondary)]" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>
        My Stuff
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
        Study materials, notes, and resources from your sessions and teacher.
      </p>

      {artifacts.length === 0 ? (
        <div
          className="rounded-lg border p-12 text-center"
          style={{
            borderColor: "var(--border-default)",
            background: "var(--surface-primary)",
          }}
        >
          <Inbox size={48} style={{ color: "var(--text-muted)", margin: "0 auto 12px" }} />
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
            No study materials yet
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            They will appear here after your calls and from your teacher.
          </p>
        </div>
      ) : (
        <>
          {teacherArtifacts.length > 0 && (
            <ArtifactSection
              title="From Your Teacher"
              icon={GraduationCap}
              artifacts={teacherArtifacts}
            />
          )}
          {sessionArtifacts.length > 0 && (
            <ArtifactSection
              title="From Your Sessions"
              icon={Phone}
              artifacts={sessionArtifacts}
            />
          )}
        </>
      )}
    </div>
  );
}

function ArtifactSection({
  title,
  icon: Icon,
  artifacts,
}: {
  title: string;
  icon: React.ElementType;
  artifacts: Artifact[];
}) {
  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={14} style={{ color: "var(--text-muted)" }} />
        <h2
          className="text-sm font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          {title}
        </h2>
        <span
          className="text-xs px-1.5 py-0.5 rounded-full"
          style={{
            background: "var(--surface-secondary)",
            color: "var(--text-muted)",
          }}
        >
          {artifacts.length}
        </span>
      </div>
      <div className="space-y-3">
        {artifacts.map((artifact) => (
          <StuffCard key={artifact.id} artifact={artifact} />
        ))}
      </div>
    </section>
  );
}

function StuffCard({ artifact }: { artifact: Artifact }) {
  const [expanded, setExpanded] = useState(false);
  const typeInfo = TYPE_CONFIG[artifact.type] || TYPE_CONFIG.KEY_FACT;
  const date = new Date(artifact.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  const time = new Date(artifact.createdAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  const contentPreview =
    !expanded && artifact.content.length > 200
      ? artifact.content.slice(0, 200) + "..."
      : artifact.content;

  const isNew = artifact.status === "DELIVERED" || artifact.status === "SENT";

  return (
    <div
      className="rounded-lg border overflow-hidden transition-all"
      style={{
        borderColor: isNew ? typeInfo.color : "var(--border-default)",
        background: "var(--surface-primary)",
      }}
    >
      {/* Type bar */}
      <div
        className="flex items-center gap-2 px-3 py-1.5"
        style={{ background: typeInfo.color }}
      >
        <span className="text-sm">{typeInfo.icon}</span>
        <span className="text-xs font-semibold text-white flex-1">
          {typeInfo.label}
        </span>
        <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.7)" }}>
          {date} {time}
        </span>
      </div>

      {/* Content */}
      <div
        className="px-3 py-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div
          className="text-sm font-semibold mb-1"
          style={{ color: "var(--text-primary)" }}
        >
          {artifact.title}
        </div>
        <div
          className="text-sm leading-relaxed whitespace-pre-wrap"
          style={{ color: "var(--text-secondary)" }}
        >
          {contentPreview}
        </div>

        {artifact.content.length > 200 && (
          <button
            className="flex items-center gap-1 mt-2 text-xs font-medium"
            style={{ color: typeInfo.color, background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {expanded ? "Show less" : "Read more"}
          </button>
        )}
      </div>
    </div>
  );
}
