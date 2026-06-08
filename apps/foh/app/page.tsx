import { Sparkles } from "lucide-react";

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 32,
        background: "var(--surface-primary)",
        color: "var(--text-primary)",
      }}
    >
      <Sparkles size={40} aria-hidden />
      <h1 style={{ fontSize: 28, fontWeight: 600 }}>
        HumanFirst — Front of House
      </h1>
      <p style={{ fontSize: 15, color: "var(--text-secondary)", maxWidth: 520, textAlign: "center" }}>
        The learner-facing experience. This is a working skeleton scaffolded from
        the software factory, mirroring the conventions of <code>apps/admin</code>.
        Start building the front-of-house flows here.
      </p>
      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <a
          href="/progress"
          style={{
            padding: "12px 28px",
            borderRadius: 12,
            background: "var(--band-high)",
            color: "#fff",
            textDecoration: "none",
            fontWeight: 600,
            fontSize: 15,
          }}
        >
          View progress →
        </a>
        <a
          href="/hf-status"
          style={{
            padding: "12px 28px",
            borderRadius: 12,
            background: "var(--surface-secondary)",
            border: "1px solid var(--border-default)",
            color: "var(--text-primary)",
            textDecoration: "none",
            fontWeight: 600,
            fontSize: 15,
          }}
        >
          Caller insights →
        </a>
        <a
          href="/sim"
          style={{
            padding: "12px 28px",
            borderRadius: 12,
            background: "var(--surface-secondary)",
            border: "1px solid var(--border-default)",
            color: "var(--text-primary)",
            textDecoration: "none",
            fontWeight: 600,
            fontSize: 15,
          }}
        >
          SIM chat →
        </a>
      </div>
    </main>
  );
}
