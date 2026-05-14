"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { BookOpen, FileText, HelpCircle, BookOpenCheck } from "lucide-react";
import { useStudentCallerId } from "@/hooks/useStudentCallerId";
import { getDocTypeInfo } from "@/lib/doc-type-icons";

interface MaterialMedia {
  id: string;
  fileName: string;
  mimeType: string;
  publicUrl: string;
}

interface Material {
  sourceId: string;
  sourceName: string;
  documentType: string | null;
  sortOrder: number;
  media: MaterialMedia | null;
  vocabulary: Array<{ term: string; definition: string; partOfSpeech: string | null }>;
  questions: Array<{ text: string; type: string }>;
}

export default function StudentMaterialsPage() {
  return (
    <Suspense fallback={<div className="p-6"><div className="animate-pulse h-8 w-48 rounded bg-[var(--surface-secondary)]" /></div>}>
      <StudentMaterialsContent />
    </Suspense>
  );
}

function StudentMaterialsContent() {
  const { isAdmin, hasSelection, buildUrl } = useStudentCallerId();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [courseName, setCourseName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMaterials = useCallback(async () => {
    if (isAdmin && !hasSelection) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(buildUrl("/api/student/materials"));
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          setMaterials(data.materials || []);
          setCourseName(data.courseName);
        }
      }
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  }, [isAdmin, hasSelection, buildUrl]);

  useEffect(() => {
    fetchMaterials();
  }, [fetchMaterials]);

  if (isAdmin && !hasSelection) {
    return (
      <div className="p-6">
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
          Open this page from a learner&apos;s profile to view their materials.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>
        My Materials
      </h1>
      <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
        {courseName
          ? `Reading materials and resources for ${courseName}.`
          : "Reading materials and resources for your course."}
      </p>

      {loading && (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="animate-pulse rounded-lg border p-6" style={{ borderColor: "var(--border-default)", background: "var(--surface-primary)" }}>
              <div className="h-5 w-48 rounded bg-[var(--surface-secondary)] mb-3" />
              <div className="h-4 w-full rounded bg-[var(--surface-secondary)] mb-2" />
              <div className="h-4 w-3/4 rounded bg-[var(--surface-secondary)]" />
            </div>
          ))}
        </div>
      )}

      {!loading && materials.length === 0 && (
        <div
          className="rounded-lg border p-12 text-center"
          style={{ borderColor: "var(--border-default)", background: "var(--surface-primary)" }}
        >
          <BookOpen size={48} style={{ color: "var(--text-muted)", margin: "0 auto 12px" }} />
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
            No materials yet
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Your teacher hasn't shared any reading materials for this course yet.
          </p>
        </div>
      )}

      {!loading && materials.length > 0 && (
        <div className="space-y-4">
          {materials.map((m) => (
            <MaterialCard key={m.sourceId} material={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function MaterialCard({ material }: { material: Material }) {
  const info = getDocTypeInfo(material.documentType || "TEXTBOOK");
  const isPdf = material.media?.mimeType === "application/pdf";
  const isImage = material.media?.mimeType?.startsWith("image/");

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: "var(--border-default)", background: "var(--surface-primary)" }}
    >
      {/* Header */}
      <div className="p-4 flex items-center gap-3" style={{ borderBottom: `1px solid var(--border-default)` }}>
        <info.icon size={18} style={{ color: info.color, flexShrink: 0 }} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
            {material.sourceName}
          </h2>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {info.label}
          </span>
        </div>
      </div>

      {/* Document viewer */}
      {material.media && isPdf && (
        <div style={{ height: 400, background: "var(--surface-secondary)" }}>
          <iframe
            src={material.media.publicUrl}
            title={material.sourceName}
            style={{ width: "100%", height: "100%", border: "none" }}
          />
        </div>
      )}

      {material.media && isImage && (
        <div className="p-4" style={{ background: "var(--surface-secondary)" }}>
          <img
            src={material.media.publicUrl}
            alt={material.sourceName}
            style={{ maxWidth: "100%", height: "auto", borderRadius: 4 }}
          />
        </div>
      )}

      {/* Vocabulary section */}
      {material.vocabulary.length > 0 && (
        <div className="p-4" style={{ borderTop: `1px solid var(--border-default)` }}>
          <h3 className="text-xs font-semibold uppercase mb-2 flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
            <BookOpenCheck size={12} />
            Key Vocabulary
          </h3>
          <dl className="space-y-1">
            {material.vocabulary.map((v) => (
              <div key={v.term} className="text-sm">
                <dt className="inline font-medium" style={{ color: "var(--text-primary)" }}>
                  {v.term}
                  {v.partOfSpeech && (
                    <span className="font-normal" style={{ color: "var(--text-muted)" }}>
                      {" "}({v.partOfSpeech})
                    </span>
                  )}
                </dt>
                <dd className="inline" style={{ color: "var(--text-secondary)" }}>
                  {" — "}{v.definition}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Questions section */}
      {material.questions.length > 0 && (
        <div className="p-4" style={{ borderTop: `1px solid var(--border-default)` }}>
          <h3 className="text-xs font-semibold uppercase mb-2 flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
            <HelpCircle size={12} />
            Questions
          </h3>
          <ol className="space-y-1 list-decimal list-inside">
            {material.questions.map((q, i) => (
              <li key={i} className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {q.text}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
