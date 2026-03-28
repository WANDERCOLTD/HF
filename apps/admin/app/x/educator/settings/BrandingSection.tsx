"use client";

import { useState, useRef } from "react";
import { CheckCircle2, X } from "lucide-react";

interface InstitutionBranding {
  id: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  welcomeMessage: string | null;
}

interface Props {
  institution: InstitutionBranding;
  canEdit: boolean;
  onSaved: () => void;
}

export function BrandingSection({ institution, canEdit, onSaved }: Props) {
  // Logo uses confirm/cancel flow (not auto-save) to prevent broken URLs
  const [logoUrl, setLogoUrl] = useState(institution.logoUrl || "");
  const [logoUrlDraft, setLogoUrlDraft] = useState(institution.logoUrl || "");
  const [logoPreviewValid, setLogoPreviewValid] = useState<boolean | null>(null);
  const [logoEditing, setLogoEditing] = useState(false);

  const [primaryColor, setPrimaryColor] = useState(institution.primaryColor || "");
  const [secondaryColor, setSecondaryColor] = useState(institution.secondaryColor || "");
  const [welcomeMessage, setWelcomeMessage] = useState(institution.welcomeMessage || "");

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();

  const save = async (body: Record<string, string | null>) => {
    setSaveStatus("saving");
    clearTimeout(saveTimer.current);
    try {
      const res = await fetch("/api/institution/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setSaveStatus("saved");
        saveTimer.current = setTimeout(() => setSaveStatus("idle"), 2000);
        onSaved();
      } else {
        setSaveStatus("error");
      }
    } catch {
      setSaveStatus("error");
    }
  };

  /** Debounced save for text/colour fields (not logo) */
  const handleFieldChange = (field: string, value: string) => {
    const body: Record<string, string | null> = {
      logoUrl,
      primaryColor: field === "primaryColor" ? value : primaryColor,
      secondaryColor: field === "secondaryColor" ? value : secondaryColor,
      welcomeMessage: field === "welcomeMessage" ? value : welcomeMessage,
    };
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => save(body), 800);
  };

  const handleLogoConfirm = () => {
    setLogoUrl(logoUrlDraft);
    setLogoEditing(false);
    setLogoPreviewValid(null);
    save({ logoUrl: logoUrlDraft || null, primaryColor, secondaryColor, welcomeMessage });
  };

  const handleLogoCancel = () => {
    setLogoUrlDraft(logoUrl);
    setLogoEditing(false);
    setLogoPreviewValid(null);
  };

  const handleLogoClear = () => {
    setLogoUrl("");
    setLogoUrlDraft("");
    setLogoEditing(false);
    setLogoPreviewValid(null);
    save({ logoUrl: null, primaryColor, secondaryColor, welcomeMessage });
  };

  return (
    <div>
      <div className="hf-flex hf-items-center hf-gap-sm hf-mb-md">
        <p className="hf-text-sm hf-text-muted hf-flex-1">
          Customise your institution&apos;s visual identity.
        </p>
        {saveStatus === "saving" && (
          <span className="hf-save-status hf-save-status--saving">
            <div className="hf-spinner hf-spinner-xs" /> Saving...
          </span>
        )}
        {saveStatus === "saved" && (
          <span className="hf-save-status hf-save-status--saved">
            <CheckCircle2 size={12} /> Saved
          </span>
        )}
        {saveStatus === "error" && (
          <span className="hf-save-status hf-save-status--error">
            Failed to save
          </span>
        )}
      </div>

      <div className="hf-settings-form hf-settings-form--narrow">
        {/* ── Logo — confirm/cancel flow ──────────────── */}
        <div>
          <span className="hf-label hf-label-block hf-mb-xs">Logo</span>

          {/* Current logo display */}
          {logoUrl && !logoEditing && (
            <div className="hf-flex hf-items-center hf-gap-sm hf-mb-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl}
                alt="Current logo"
                style={{ height: 28, maxWidth: 160, objectFit: "contain" }}
                onError={(e) => { (e.currentTarget).style.display = "none"; }}
                onLoad={(e) => { (e.currentTarget).style.display = "block"; }}
              />
              {canEdit && (
                <div className="hf-flex hf-gap-xs">
                  <button type="button" className="hf-btn hf-btn-xs hf-btn-outline" onClick={() => { setLogoUrlDraft(logoUrl); setLogoEditing(true); }}>
                    Change
                  </button>
                  <button type="button" className="hf-btn hf-btn-xs hf-btn-secondary" onClick={handleLogoClear} title="Remove logo">
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* No logo — show add button */}
          {!logoUrl && !logoEditing && canEdit && (
            <button type="button" className="hf-btn hf-btn-xs hf-btn-outline" onClick={() => { setLogoUrlDraft(""); setLogoEditing(true); }}>
              Add logo URL
            </button>
          )}

          {/* Editing mode — input + preview + OK/Cancel */}
          {logoEditing && (
            <div>
              <input
                type="text"
                className="hf-input hf-mb-sm"
                placeholder="https://example.com/logo.png"
                value={logoUrlDraft}
                onChange={(e) => { setLogoUrlDraft(e.target.value); setLogoPreviewValid(null); }}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && logoPreviewValid) handleLogoConfirm();
                  if (e.key === "Escape") handleLogoCancel();
                }}
              />
              {logoUrlDraft && (
                <div className="hf-mb-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logoUrlDraft}
                    alt="Logo preview"
                    style={{ height: 32, maxWidth: 200, objectFit: "contain" }}
                    onError={() => setLogoPreviewValid(false)}
                    onLoad={() => setLogoPreviewValid(true)}
                  />
                  {logoPreviewValid === false && (
                    <div className="hf-text-xs hf-text-error hf-mt-xs">Image failed to load — check the URL</div>
                  )}
                </div>
              )}
              <div className="hf-flex hf-gap-xs">
                <button type="button" className="hf-btn hf-btn-xs hf-btn-primary" disabled={!logoUrlDraft || logoPreviewValid === false} onClick={handleLogoConfirm}>
                  OK
                </button>
                <button type="button" className="hf-btn hf-btn-xs hf-btn-secondary" onClick={handleLogoCancel}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Primary colour ─────────────────────────── */}
        <div>
          <span className="hf-label hf-label-block hf-mb-xs">Primary colour</span>
          <div className="hf-flex hf-items-center hf-gap-sm">
            {primaryColor && (
              <span className="hf-color-swatch" style={{ background: primaryColor }} />
            )}
            <input
              type="text"
              className="hf-input hf-flex-1"
              placeholder="#3B82F6"
              value={primaryColor}
              onChange={(e) => { setPrimaryColor(e.target.value); handleFieldChange("primaryColor", e.target.value); }}
              disabled={!canEdit}
            />
          </div>
        </div>

        {/* ── Secondary colour ───────────────────────── */}
        <div>
          <span className="hf-label hf-label-block hf-mb-xs">Secondary colour</span>
          <div className="hf-flex hf-items-center hf-gap-sm">
            {secondaryColor && (
              <span className="hf-color-swatch" style={{ background: secondaryColor }} />
            )}
            <input
              type="text"
              className="hf-input hf-flex-1"
              placeholder="#60A5FA"
              value={secondaryColor}
              onChange={(e) => { setSecondaryColor(e.target.value); handleFieldChange("secondaryColor", e.target.value); }}
              disabled={!canEdit}
            />
          </div>
        </div>

        {/* ── Welcome message ────────────────────────── */}
        <div>
          <span className="hf-label hf-label-block hf-mb-xs">Welcome message</span>
          <textarea
            className="hf-input"
            rows={2}
            placeholder="Welcome to our learning platform..."
            value={welcomeMessage}
            onChange={(e) => { setWelcomeMessage(e.target.value); handleFieldChange("welcomeMessage", e.target.value); }}
            disabled={!canEdit}
            style={{ width: "100%", resize: "vertical" }}
          />
          <div className="hf-text-xs hf-text-muted hf-mt-xs">
            Shown to learners when they first join.
          </div>
        </div>
      </div>
    </div>
  );
}
