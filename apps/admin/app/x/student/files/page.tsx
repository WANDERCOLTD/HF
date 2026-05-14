"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { Paperclip } from "lucide-react";
import { MediaLibrary, type SharedMediaItem } from "@/components/shared/MediaLibrary";
import { useStudentCallerId } from "@/hooks/useStudentCallerId";

export default function StudentFilesPage() {
  return (
    <Suspense fallback={<div className="p-6"><div className="animate-pulse h-8 w-48 rounded bg-[var(--surface-secondary)]" /></div>}>
      <StudentFilesContent />
    </Suspense>
  );
}

function StudentFilesContent() {
  const { isAdmin, hasSelection, buildUrl } = useStudentCallerId();
  const [items, setItems] = useState<SharedMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"date" | "name" | "type">("date");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState<"all" | "image" | "pdf" | "audio">("all");

  const fetchMedia = useCallback(async () => {
    if (isAdmin && !hasSelection) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(buildUrl("/api/student/media", { sort, order, type: filter }));
      if (res.ok) {
        const data = await res.json();
        if (data.ok) setItems(data.media || []);
      }
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  }, [sort, order, filter, isAdmin, hasSelection, buildUrl]);

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  if (isAdmin && !hasSelection) {
    return (
      <div className="p-6">
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
          Open this page from a learner&apos;s profile to view their files.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>
        My Files
      </h1>
      <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
        Documents, images, and audio shared during your sessions.
      </p>

      {!loading && items.length === 0 ? (
        <div
          className="rounded-lg border p-12 text-center"
          style={{
            borderColor: "var(--border-default)",
            background: "var(--surface-primary)",
          }}
        >
          <Paperclip size={48} style={{ color: "var(--text-muted)", margin: "0 auto 12px" }} />
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
            No files yet
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Files shared during your calls will appear here.
          </p>
        </div>
      ) : (
        <MediaLibrary
          items={items}
          loading={loading}
          sort={sort}
          order={order}
          filter={filter}
          onSortChange={setSort}
          onOrderChange={setOrder}
          onFilterChange={setFilter}
          emptyMessage="No files match your filters"
        />
      )}
    </div>
  );
}
