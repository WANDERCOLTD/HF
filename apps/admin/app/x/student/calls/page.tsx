"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { Phone } from "lucide-react";
import { useStudentCallerId } from "@/hooks/useStudentCallerId";

interface CallItem {
  id: string;
  createdAt: string;
  endedAt: string | null;
  domain: string | null;
}

export default function StudentCallsPage() {
  return (
    <Suspense fallback={<div className="p-6"><div className="animate-pulse h-8 w-36 rounded bg-[var(--surface-secondary)]" /></div>}>
      <StudentCallsContent />
    </Suspense>
  );
}

function StudentCallsContent() {
  const { isAdmin, hasSelection, buildUrl } = useStudentCallerId();
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isAdmin && !hasSelection) { setLoading(false); return; }
    fetch(buildUrl("/api/student/calls"))
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setCalls(d.calls);
      })
      .finally(() => setLoading(false));
  }, [isAdmin, hasSelection, buildUrl]);

  if (isAdmin && !hasSelection) {
    return (
      <div className="p-6">
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
          Open this page from a learner&apos;s profile to view their call history.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-8 w-36 rounded bg-[var(--surface-secondary)]" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-[var(--surface-secondary)]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
        My Calls
      </h1>

      {calls.length === 0 ? (
        <div
          className="rounded-lg border p-8 text-center"
          style={{
            borderColor: "var(--border-default)",
            background: "var(--surface-primary)",
          }}
        >
          <Phone size={32} className="mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            No calls yet. Start a practice session to see your history here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {calls.map((call) => {
            const date = new Date(call.createdAt);
            const duration = call.endedAt
              ? Math.round((new Date(call.endedAt).getTime() - date.getTime()) / 60000)
              : null;

            return (
              <Link
                key={call.id}
                href={`/x/student/calls/${call.id}`}
                className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-[var(--hover-bg)]"
                style={{
                  borderColor: "var(--border-default)",
                  background: "var(--surface-primary)",
                  textDecoration: "none",
                }}
              >
                <div className="flex items-center gap-3">
                  <Phone size={16} style={{ color: "var(--text-muted)" }} />
                  <div>
                    <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {date.toLocaleDateString()} at {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {call.domain ?? "General"}
                      {duration !== null ? ` \u2022 ${duration} min` : ""}
                    </p>
                  </div>
                </div>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>\u203A</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
