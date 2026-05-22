"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DesktopModeToggle } from "@/components/shared/DesktopModeToggle";
import { Search, User, Phone, TrendingUp, Globe } from "lucide-react";

/**
 * Callers Mobile Page - Card-based list view
 *
 * Features:
 * - Search bar (sticky)
 * - Caller cards (stacked)
 * - Tap card → navigate to caller detail
 * - Shows: name, call count, confidence, domain
 */

type CallerSummary = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  personality: { confidenceScore: number | null } | null;
  _count?: { calls: number; memories: number };
  domain: { id: string; name: string; slug: string } | null;
};

export default function CallersMobilePage() {
  const router = useRouter();
  const [callers, setCallers] = useState<CallerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetchCallers();
  }, []);

  const fetchCallers = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/callers?withCounts=true");
      const data = await res.json();
      if (data.ok) {
        setCallers(data.callers || []);
      }
    } catch (error) {
      console.error("Failed to fetch callers:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredCallers = callers.filter((caller) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      caller.name?.toLowerCase().includes(query) ||
      caller.email?.toLowerCase().includes(query) ||
      caller.phone?.includes(query) ||
      caller.domain?.name.toLowerCase().includes(query)
    );
  });

  const getConfidenceBadge = (confidence: number | null | undefined) => {
    if (confidence == null || !Number.isFinite(confidence)) {
      return { label: "No data", color: "bg-gray-100 text-gray-700" };
    }
    if (confidence >= 0.8) return { label: "High", color: "bg-green-100 text-green-700" };
    if (confidence >= 0.5) return { label: "Medium", color: "bg-yellow-100 text-yellow-700" };
    return { label: "Low", color: "bg-red-100 text-red-700" };
  };

  return (
    <div className="flex flex-col h-full">
      {/* Desktop mode toggle */}
      <div className="p-4">
        <DesktopModeToggle />
      </div>

      {/* Header */}
      <div className="px-4 pb-3">
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          Callers
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          {filteredCallers.length} {filteredCallers.length === 1 ? "caller" : "callers"}
        </p>
      </div>

      {/* Search bar (sticky) */}
      <div className="sticky top-0 z-10 px-4 pb-3" style={{ background: "var(--surface-primary)" }}>
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, email, phone, or domain..."
            className="w-full pl-10 pr-3 py-2.5 rounded-lg border text-sm"
            style={{
              borderColor: "var(--border-default)",
              background: "var(--surface-primary)",
              color: "var(--text-primary)",
            }}
          />
        </div>
      </div>

      {/* Caller cards */}
      <div className="flex-1 overflow-auto px-4 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div
              className="w-8 h-8 border-3 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: "var(--accent-primary)", borderTopColor: "transparent" }}
            />
          </div>
        ) : filteredCallers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <User className="w-12 h-12" style={{ color: "var(--text-muted)" }} />
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {searchQuery ? "No callers match your search" : "No callers found"}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredCallers.map((caller) => {
              const confidence = caller.personality?.confidenceScore ?? null;
              const callCount = caller._count?.calls ?? 0;
              const confidenceBadge = getConfidenceBadge(confidence);
              const showConfidencePct = confidence != null && Number.isFinite(confidence);
              return (
                <button
                  key={caller.id}
                  onClick={() => router.push(`/x/callers/${caller.id}`)}
                  className="w-full text-left p-4 rounded-lg border transition-all active:scale-98"
                  style={{
                    borderColor: "var(--border-default)",
                    background: "var(--surface-secondary)",
                  }}
                >
                  {/* Caller name/identifier */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-base truncate" style={{ color: "var(--text-primary)" }}>
                        {caller.name || caller.email || caller.phone || `Caller ${caller.id.slice(0, 8)}`}
                      </h3>
                      {caller.name && (caller.email || caller.phone) && (
                        <p className="text-xs truncate mt-0.5" style={{ color: "var(--text-muted)" }}>
                          {caller.email || caller.phone}
                        </p>
                      )}
                    </div>
                    {/* Confidence badge */}
                    <span
                      className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${confidenceBadge.color}`}
                    >
                      {confidenceBadge.label}
                    </span>
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
                    {/* Call count */}
                    <div className="flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5" />
                      <span>
                        {callCount} {callCount === 1 ? "call" : "calls"}
                      </span>
                    </div>

                    {/* Confidence score */}
                    {showConfidencePct && (
                      <div className="flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5" />
                        <span>{Math.round(confidence * 100)}%</span>
                      </div>
                    )}

                    {/* Domain */}
                    {caller.domain && (
                      <div className="flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5" />
                        <span className="truncate">{caller.domain.name}</span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Info card */}
      <div className="px-4 pb-4">
        <div className="p-3 rounded-lg text-xs" style={{ background: "rgba(99, 102, 241, 0.1)", color: "var(--text-secondary)" }}>
          <p className="mb-1 font-semibold" style={{ color: "var(--accent-primary)" }}>
            📱 Mobile Callers View
          </p>
          <p>Tap any caller card to view full details. For advanced features like editing or creating new callers, switch to Desktop Mode above.</p>
        </div>
      </div>
    </div>
  );
}
