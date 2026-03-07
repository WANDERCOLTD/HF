"use client";

import { useState, useRef } from "react";
import { CheckCircle2 } from "lucide-react";

interface InstitutionBranding {
  id: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
}

interface Props {
  institution: InstitutionBranding;
  canEdit: boolean;
  onSaved: () => void;
}

export function BrandingSection({ institution, canEdit, onSaved }: Props) {
  const [logoUrl, setLogoUrl] = useState(institution.logoUrl || "");
  const [primaryColor, setPrimaryColor] = useState(institution.primaryColor || "");
  const [secondaryColor, setSecondaryColor] = useState(institution.secondaryColor || "");
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

  const handleChange = (field: string, value: string) => {
    const body = {
      logoUrl: field === "logoUrl" ? value : logoUrl,
      primaryColor: field === "primaryColor" ? value : primaryColor,
      secondaryColor: field === "secondaryColor" ? value : secondaryColor,
    };
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => save(body), 800);
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
        {/* Logo URL */}
        <div>
          <span className="hf-label hf-label-block hf-mb-xs">Logo URL</span>
          <input
            type="text"
            className="hf-input"
            placeholder="https://example.com/logo.png"
            value={logoUrl}
            onChange={(e) => { setLogoUrl(e.target.value); handleChange("logoUrl", e.target.value); }}
            disabled={!canEdit}
          />
          {logoUrl && (
            <div className="hf-mt-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl}
                alt="Logo preview"
                className="hf-logo-preview"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                onLoad={(e) => { (e.target as HTMLImageElement).style.display = "block"; }}
              />
            </div>
          )}
        </div>

        {/* Primary colour */}
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
              onChange={(e) => { setPrimaryColor(e.target.value); handleChange("primaryColor", e.target.value); }}
              disabled={!canEdit}
            />
          </div>
        </div>

        {/* Secondary colour */}
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
              onChange={(e) => { setSecondaryColor(e.target.value); handleChange("secondaryColor", e.target.value); }}
              disabled={!canEdit}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
