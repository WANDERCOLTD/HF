"use client";

import type { CallerData, SectionId, ParamConfig } from "./types";
import { CATEGORY_COLORS } from "./constants";

export function OverviewSection({
  data,
  onNavigate,
  paramConfig,
}: {
  data: CallerData;
  onNavigate: (section: SectionId | null) => void;
  paramConfig: ParamConfig;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
      {/* Quick Stats */}
      <div style={{ background: "var(--surface-primary)", border: "1px solid var(--border-default)", borderRadius: 12, padding: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 16 }}>Quick Stats</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <StatCard label="Total Calls" value={data.counts.calls} icon="📞" onClick={() => onNavigate("calls-prompts")} />
          <StatCard label="Memories" value={data.counts.memories} icon="💭" onClick={() => onNavigate("how")} />
          <StatCard label="Observations" value={data.counts.observations} icon="👁️" onClick={() => onNavigate("how")} />
          <StatCard
            label="Parameters"
            value={data.personality?.parameterValues ? Object.keys(data.personality.parameterValues).length : 0}
            icon="📊"
            onClick={() => onNavigate("how")}
          />
        </div>
      </div>

      {/* Personality Summary - Dynamically show all parameter groups */}
      {data.personality && data.personality.parameterValues && paramConfig && (
        <div
          style={{ background: "var(--surface-primary)", border: "1px solid var(--border-default)", borderRadius: 12, padding: 20, cursor: "pointer" }}
          onClick={() => onNavigate("how")}
        >
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 16 }}>Personality Profile</h3>

          {/* Dynamically render all parameter groups */}
          {Object.entries(paramConfig.grouped).map(([groupName, params]) => {
            // Check if any parameters in this group have values
            const hasValues = params.some(param => data.personality?.parameterValues?.[param.parameterId] !== undefined);
            if (!hasValues) return null;

            return (
              <div key={groupName} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-placeholder)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  {groupName}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {params.map(param => {
                    const value = data.personality?.parameterValues?.[param.parameterId];
                    if (value === undefined) return null;
                    return (
                      <div key={param.parameterId} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 12, color: "var(--text-muted)", width: 100 }}>{param.label}</span>
                        <div style={{ flex: 1, height: 8, background: "var(--border-default)", borderRadius: 4, overflow: "hidden" }}>
                          <div
                            style={{
                              height: "100%",
                              width: `${(value || 0) * 100}%`,
                              background: param.color,
                              borderRadius: 4,
                            }}
                          />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", width: 40, textAlign: "right" }}>
                          {value !== null ? (value * 100).toFixed(0) : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Key Facts */}
      {data.memorySummary && data.memorySummary.keyFacts.length > 0 && (
        <div
          style={{ background: "var(--surface-primary)", border: "1px solid var(--border-default)", borderRadius: 12, padding: 20, cursor: "pointer" }}
          onClick={() => onNavigate("how")}
        >
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 16 }}>Key Facts</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.memorySummary.keyFacts.slice(0, 5).map((fact, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "var(--text-muted)" }}>{fact.key}</span>
                <span style={{ fontWeight: 500 }}>{fact.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preferences */}
      {data.memorySummary && Object.keys(data.memorySummary.preferences).length > 0 && (
        <div
          style={{ background: "var(--surface-primary)", border: "1px solid var(--border-default)", borderRadius: 12, padding: 20, cursor: "pointer" }}
          onClick={() => onNavigate("how")}
        >
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 16 }}>Preferences</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {Object.entries(data.memorySummary.preferences).slice(0, 6).map(([key, value]) => (
              <span
                key={key}
                style={{
                  padding: "4px 10px",
                  background: CATEGORY_COLORS.PREFERENCE.bg,
                  color: CATEGORY_COLORS.PREFERENCE.text,
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                {key}: {value}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recent Calls */}
      <div
        style={{ background: "var(--surface-primary)", border: "1px solid var(--border-default)", borderRadius: 12, padding: 20, cursor: "pointer" }}
        onClick={() => onNavigate("calls-prompts")}
      >
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 16 }}>Recent Calls</h3>
        {data.calls.length === 0 ? (
          <div style={{ color: "var(--text-placeholder)", fontSize: 13 }}>No calls yet</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.calls.slice(0, 3).map((call) => (
              <div key={call.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "var(--text-secondary)" }}>{call.source}</span>
                <span style={{ color: "var(--text-placeholder)" }}>{new Date(call.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  onClick,
}: {
  label: string;
  value: number | string;
  icon: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: 12,
        background: "var(--background)",
        borderRadius: 8,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span>{icon}</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 600, color: "var(--text-primary)" }}>{value}</div>
    </div>
  );
}
