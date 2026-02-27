"use client";

import AIEngineSettingsCard from "../../../components/cockpit/AIEngineSettingsCard";

export default function AdminPage() {
  return (
    <div className="hf-page-container">
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 className="hf-page-title">Admin</h1>
        <p style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 4 }}>
          System-wide settings and configuration
        </p>
      </div>

      {/* AI Engine Settings */}
      <div style={{ marginBottom: 20 }}>
        <AIEngineSettingsCard />
      </div>

      {/* Future sections placeholder */}
      <div
        style={{
          background: "var(--surface-secondary)",
          border: "1px dashed var(--border-default)",
          borderRadius: 12,
          padding: 24,
          textAlign: "center",
          color: "var(--text-muted)",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 500 }}>More settings coming soon</div>
        <div style={{ fontSize: 12, marginTop: 4 }}>
          API keys, retention policies, default behaviors
        </div>
      </div>
    </div>
  );
}
