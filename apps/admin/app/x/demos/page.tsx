"use client";

import { useState } from "react";
import { SourcePageHeader } from "@/components/shared/SourcePageHeader";
import { DemoListingCard } from "@/components/demo/DemoListingCard";
import { listDemos } from "@/lib/demo/registry";
import type { DemoAudience } from "@/lib/demo/types";

const AUDIENCE_FILTERS: { value: DemoAudience | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "operator", label: "Operators" },
  { value: "team_member", label: "Team Members" },
  { value: "evaluator", label: "Evaluators" },
  { value: "developer", label: "Developers" },
];

export default function DemosPage() {
  const [audienceFilter, setAudienceFilter] = useState<DemoAudience | "all">("all");
  const allDemos = listDemos();

  const filteredDemos =
    audienceFilter === "all"
      ? allDemos
      : allDemos.filter((d) => d.audience.includes(audienceFilter));

  return (
    <div className="hf-page-container">
      <SourcePageHeader
        title="Interactive Demos"
        description="Step-by-step walkthroughs of key workflows. Watch, learn, and ask the AI assistant questions at any point."
      />

      {/* Audience filter */}
      <div
        style={{
          display: "flex",
          gap: 6,
          marginBottom: 24,
          flexWrap: "wrap",
        }}
      >
        {AUDIENCE_FILTERS.map((filter) => (
          <button
            key={filter.value}
            onClick={() => setAudienceFilter(filter.value)}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 6,
              border:
                audienceFilter === filter.value
                  ? "1px solid var(--accent-primary)"
                  : "1px solid var(--border-default)",
              background:
                audienceFilter === filter.value
                  ? "color-mix(in srgb, var(--accent-primary) 10%, transparent)"
                  : "transparent",
              color:
                audienceFilter === filter.value
                  ? "var(--accent-primary)"
                  : "var(--text-secondary)",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Demo grid */}
      {filteredDemos.length === 0 ? (
        <div
          style={{
            padding: 40,
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: 14,
          }}
        >
          {allDemos.length === 0
            ? "No demos available yet."
            : `No demos for "${audienceFilter}" audience.`}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
            gap: 16,
          }}
        >
          {filteredDemos.map((demo) => (
            <DemoListingCard key={demo.id} spec={demo} />
          ))}
        </div>
      )}
    </div>
  );
}
