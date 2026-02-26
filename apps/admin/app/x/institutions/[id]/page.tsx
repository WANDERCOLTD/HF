"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  type TerminologyPresetId,
  type TerminologyConfig,
  type TerminologyOverrides,
  TERMINOLOGY_PRESETS,
  PRESET_OPTIONS,
  resolveTerminology,
} from "@/lib/terminology/types";
import { HierarchyBreadcrumb } from "@/components/shared/HierarchyBreadcrumb";
import { DraggableTabs, type TabDefinition } from "@/components/shared/DraggableTabs";

type TabId = "settings" | "terminology";

const TABS: TabDefinition[] = [
  { id: "settings", label: "Settings" },
  { id: "terminology", label: "Terminology" },
];

interface InstitutionDetail {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  welcomeMessage: string | null;
  terminology: TerminologyConfig | null;
  isActive: boolean;
  userCount: number;
  cohortCount: number;
}

export default function InstitutionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [institution, setInstitution] = useState<InstitutionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [fetchError, setFetchError] = useState<"forbidden" | "not-found" | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("settings");

  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#4f46e5");
  const [secondaryColor, setSecondaryColor] = useState("#3b82f6");
  const [welcomeMessage, setWelcomeMessage] = useState("");

  // Terminology state
  const [termPreset, setTermPreset] = useState<TerminologyPresetId>("corporate");
  const [termOverrides, setTermOverrides] = useState<TerminologyOverrides>({});
  const [showTermCustomize, setShowTermCustomize] = useState(false);

  const resolvedTerms = resolveTerminology({ preset: termPreset, overrides: termOverrides });

  useEffect(() => {
    fetch(`/api/institutions/${id}`)
      .then((r) => {
        if (r.status === 403) { setFetchError("forbidden"); return null; }
        if (r.status === 404) { setFetchError("not-found"); return null; }
        return r.json();
      })
      .then((res) => {
        if (res?.ok) {
          const inst = res.institution;
          setInstitution(inst);
          setName(inst.name);
          setLogoUrl(inst.logoUrl || "");
          setPrimaryColor(inst.primaryColor || "#4f46e5");
          setSecondaryColor(inst.secondaryColor || "#3b82f6");
          setWelcomeMessage(inst.welcomeMessage || "");
          if (inst.terminology) {
            setTermPreset(inst.terminology.preset || "corporate");
            setTermOverrides(inst.terminology.overrides || {});
          }
        } else if (res && !res.ok) {
          setFetchError("not-found");
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    setMessage("");

    const terminologyConfig: TerminologyConfig = {
      preset: termPreset,
      ...(Object.keys(termOverrides).length > 0 ? { overrides: termOverrides } : {}),
    };

    const res = await fetch(`/api/institutions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        logoUrl: logoUrl || null,
        primaryColor: primaryColor || null,
        secondaryColor: secondaryColor || null,
        welcomeMessage: welcomeMessage || null,
        terminology: terminologyConfig,
      }),
    });

    const data = await res.json();
    if (data.ok) {
      setInstitution(data.institution);
      setMessage("Saved");
      setTimeout(() => setMessage(""), 2000);
    } else {
      setMessage(data.error || "Save failed");
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="hf-page-container">
        <div className="hf-empty-compact"><div className="hf-spinner" /></div>
      </div>
    );
  }

  if (fetchError === "forbidden") {
    return (
      <div className="hf-page-container">
        <HierarchyBreadcrumb segments={[{ label: "Institutions", href: "/x/institutions" }]} />
        <div className="hf-banner hf-banner-error hf-mt-md">
          You don&apos;t have permission to view this institution.
        </div>
        <button onClick={() => router.push("/x/institutions")} className="hf-btn hf-btn-secondary hf-mt-md">
          ← Go back
        </button>
      </div>
    );
  }

  if (!institution) {
    return (
      <div className="hf-page-container">
        <HierarchyBreadcrumb segments={[{ label: "Institutions", href: "/x/institutions" }]} />
        <div className="hf-banner hf-banner-error hf-mt-md">Institution not found.</div>
      </div>
    );
  }

  return (
    <div className="hf-page-container hf-page-scroll">
      {/* Breadcrumb */}
      <HierarchyBreadcrumb
        segments={[
          { label: "Institutions", href: "/x/institutions" },
          { label: institution.name, href: `/x/institutions/${id}` },
        ]}
      />

      {/* Hero */}
      <div className="hf-flex hf-gap-md hf-items-center hf-mb-lg hf-mt-md">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt="Logo"
            style={{ width: 48, height: 48, objectFit: "contain", borderRadius: 8, border: "1px solid var(--border-default)" }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div
            className="hf-icon-box-lg"
            style={{ background: primaryColor, color: "#fff", fontSize: 20, fontWeight: 700 }}
          >
            {institution.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="hf-page-title hf-mb-xs">{institution.name}</h1>
          <div className="hf-flex hf-gap-md hf-text-xs hf-text-muted hf-items-center">
            <span className="hf-mono">{institution.slug}</span>
            <span>{institution.userCount} users</span>
            <span>{institution.cohortCount} cohorts</span>
            <div className="hf-flex hf-gap-xs">
              <div style={{ width: 16, height: 16, borderRadius: 4, background: primaryColor, border: "1px solid var(--border-default)" }} title="Primary color" />
              <div style={{ width: 16, height: 16, borderRadius: 4, background: secondaryColor, border: "1px solid var(--border-default)" }} title="Secondary color" />
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <DraggableTabs
        storageKey="institution-detail-tabs"
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={(t) => setActiveTab(t as TabId)}
        showReset={false}
      />

      {/* ── Settings Tab ──────────────────────────────── */}
      {activeTab === "settings" && (
        <div className="hf-mt-lg">
          {/* Live branding preview */}
          <div className="hf-card-compact hf-mb-lg">
            <div className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase hf-mb-sm">Preview</div>
            <div className="hf-flex hf-gap-md hf-items-center">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Logo preview"
                  style={{ width: 36, height: 36, objectFit: "contain", borderRadius: 6 }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <div
                  className="hf-icon-box"
                  style={{ background: primaryColor, color: "#fff", fontWeight: 700 }}
                >
                  {name.charAt(0) || "?"}
                </div>
              )}
              <div>
                <div className="hf-text-sm hf-text-bold">{name || "Institution Name"}</div>
              </div>
              <div className="hf-flex hf-gap-xs hf-ml-auto">
                <div style={{ width: 20, height: 20, borderRadius: 4, background: primaryColor, border: "1px solid var(--border-default)" }} title="Primary" />
                <div style={{ width: 20, height: 20, borderRadius: 4, background: secondaryColor, border: "1px solid var(--border-default)" }} title="Secondary" />
              </div>
            </div>
          </div>

          {/* Edit Form */}
          <div className="hf-card hf-mb-lg">
            <div className="hf-flex-col hf-gap-md">
              <div>
                <label className="hf-label">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Institution name"
                  className="hf-input"
                />
              </div>

              <div>
                <label className="hf-label">Logo URL</label>
                <input
                  type="text"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://example.com/logo.png"
                  className="hf-input"
                />
              </div>

              <div>
                <label className="hf-label">Primary Color</label>
                <div className="hf-flex hf-gap-sm hf-items-center">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    style={{ width: 40, height: 36, border: "1px solid var(--border-default)", borderRadius: 6, cursor: "pointer", padding: 2 }}
                  />
                  <input
                    type="text"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    placeholder="#4f46e5"
                    className="hf-input hf-flex-1"
                  />
                </div>
              </div>

              <div>
                <label className="hf-label">Secondary Color</label>
                <div className="hf-flex hf-gap-sm hf-items-center">
                  <input
                    type="color"
                    value={secondaryColor}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                    style={{ width: 40, height: 36, border: "1px solid var(--border-default)", borderRadius: 6, cursor: "pointer", padding: 2 }}
                  />
                  <input
                    type="text"
                    value={secondaryColor}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                    placeholder="#3b82f6"
                    className="hf-input hf-flex-1"
                  />
                </div>
              </div>

              <div>
                <label className="hf-label">Welcome Message</label>
                <textarea
                  value={welcomeMessage}
                  onChange={(e) => setWelcomeMessage(e.target.value)}
                  placeholder="Welcome to our learning platform!"
                  rows={3}
                  className="hf-textarea"
                />
              </div>
            </div>
          </div>

          <div className="hf-flex hf-gap-md hf-items-center">
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="hf-btn hf-btn-primary"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
            {message && (
              <span className={`hf-text-sm ${message === "Saved" ? "hf-text-success" : "hf-text-error"}`}>
                {message}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Terminology Tab ───────────────────────────── */}
      {activeTab === "terminology" && (
        <div className="hf-mt-lg">
          <p className="hf-section-desc hf-mb-lg">
            Choose how your institution labels key concepts. This affects sidebar navigation and dashboard labels for all users in this institution.
          </p>

          {/* Preset Picker */}
          <div className="hf-card-grid-md hf-mb-lg">
            {PRESET_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => { setTermPreset(opt.id); setTermOverrides({}); setShowTermCustomize(false); }}
                className="hf-card-compact hf-text-left"
                style={termPreset === opt.id ? {
                  borderColor: "var(--accent-primary)",
                  background: "color-mix(in srgb, var(--accent-primary) 8%, var(--surface-primary))",
                } : undefined}
              >
                <div className="hf-text-sm hf-text-bold hf-mb-xs">{opt.label}</div>
                <div className="hf-text-xs hf-text-muted">{opt.description}</div>
              </button>
            ))}
          </div>

          {/* Preview Table */}
          <div className="hf-card-compact hf-mb-lg">
            <div className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase hf-mb-sm">Preview</div>
            <div className="hf-flex-col">
              {(["institution", "cohort", "learner", "instructor", "supervisor"] as const).map((key) => (
                <div
                  key={key}
                  className="hf-flex hf-flex-between hf-items-center"
                  style={{ padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}
                >
                  <span className="hf-text-xs hf-text-muted">{key}</span>
                  <span className="hf-text-sm">
                    {resolvedTerms[key]}
                    {termOverrides[key] && <span className="hf-tag-pill hf-ml-sm">custom</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Customize Toggle */}
          <button
            onClick={() => setShowTermCustomize(!showTermCustomize)}
            className="hf-btn hf-btn-secondary hf-mb-md"
          >
            {showTermCustomize ? "Hide customization" : "Customize individual terms"}
          </button>

          {/* Customize Fields */}
          {showTermCustomize && (
            <div className="hf-card hf-mb-lg">
              <div className="hf-flex-col hf-gap-md">
                {(["institution", "cohort", "learner", "instructor", "supervisor"] as const).map((key) => (
                  <div key={key}>
                    <label className="hf-label" style={{ textTransform: "capitalize" }}>{key}</label>
                    <input
                      type="text"
                      value={termOverrides[key] ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setTermOverrides((prev) => {
                          if (!val.trim()) { const next = { ...prev }; delete next[key]; return next; }
                          return { ...prev, [key]: val };
                        });
                      }}
                      placeholder={TERMINOLOGY_PRESETS[termPreset][key]}
                      className="hf-input"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="hf-flex hf-gap-md hf-items-center">
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="hf-btn hf-btn-primary"
            >
              {saving ? "Saving..." : "Save Terminology"}
            </button>
            {message && (
              <span className={`hf-text-sm ${message === "Saved" ? "hf-text-success" : "hf-text-error"}`}>
                {message}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
