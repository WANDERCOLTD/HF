"use client";

import { useState, useEffect } from "react";
import { FieldHint } from "@/components/shared/FieldHint";
import { WIZARD_HINTS } from "@/lib/wizard-hints";
import { StepFooter } from "@/components/wizards/StepFooter";
import { applyBrandingToDOM, clearBrandingFromDOM } from "@/lib/branding";
import type { StepRenderProps } from "@/components/wizards/types";

export function BrandingStep({ getData, setData, onNext, onPrev }: StepRenderProps) {
  const institutionName = getData<string>("institutionName") ?? "";
  // Initialise from data bag — IdentityStep may have pre-filled these via URL import
  const [logoUrl, setLogoUrl] = useState(getData<string>("logoUrl") ?? "");
  const [primaryColor, setPrimaryColor] = useState(getData<string>("primaryColor") ?? "");
  const [secondaryColor, setSecondaryColor] = useState(getData<string>("secondaryColor") ?? "");

  // Live DOM preview — apply when colours change, clean up on unmount
  useEffect(() => {
    if (!primaryColor && !secondaryColor) return;
    applyBrandingToDOM({
      name: institutionName || "Preview",
      typeName: null,
      logoUrl: logoUrl || null,
      primaryColor: primaryColor || null,
      secondaryColor: secondaryColor || null,
      welcomeMessage: null,
    });
    return () => {
      clearBrandingFromDOM();
    };
  }, [primaryColor, secondaryColor, logoUrl, institutionName]);

  const handleContinue = () => {
    setData("logoUrl", logoUrl);
    setData("primaryColor", primaryColor);
    setData("secondaryColor", secondaryColor);
    onNext();
  };

  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">
        <div className="hf-mb-lg">
          <h1 className="hf-page-title hf-mb-xs">Make it yours</h1>
          <p className="hf-page-subtitle">Add your logo and brand colours</p>
        </div>

        <div className="hf-mb-lg">
          <FieldHint label="Logo URL" hint={WIZARD_HINTS["institution.logo"]} labelClass="hf-label" />
          <div className="hf-flex hf-items-center hf-gap-md">
            <div className="hf-avatar-circle">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Logo" />
              ) : (
                institutionName.charAt(0).toUpperCase() || "?"
              )}
            </div>
            <input
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
              className="hf-input hf-flex-1"
            />
          </div>
        </div>

        <div className="hf-mb-lg">
          <FieldHint label="Primary Colour" hint={WIZARD_HINTS["institution.primaryColor"]} labelClass="hf-label" />
          <div className="hf-flex hf-items-center hf-gap-sm">
            <input
              type="color"
              value={primaryColor || "#3b82f6"}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="hf-color-swatch"
            />
            <input
              type="text"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              placeholder="#3b82f6"
              className="hf-input hf-flex-1"
            />
          </div>
        </div>

        <div className="hf-mb-lg">
          <label className="hf-label">Secondary Colour</label>
          <div className="hf-flex hf-items-center hf-gap-sm">
            <input
              type="color"
              value={secondaryColor || "#6366f1"}
              onChange={(e) => setSecondaryColor(e.target.value)}
              className="hf-color-swatch"
            />
            <input
              type="text"
              value={secondaryColor}
              onChange={(e) => setSecondaryColor(e.target.value)}
              placeholder="#6366f1"
              className="hf-input hf-flex-1"
            />
          </div>
        </div>

        {(primaryColor || institutionName) && (
          <div className="hf-card hf-card-compact">
            <p className="hf-category-label">Live Preview</p>
            <div className="hf-flex hf-items-center hf-gap-sm">
              <div
                className="hf-branding-dot"
                style={{ background: primaryColor || "var(--accent-primary)" }}
              />
              <span className="hf-flex-1 hf-text-sm hf-text-bold">{institutionName || "Institution"}</span>
              <span
                className="hf-branding-btn-preview"
                style={{ background: primaryColor || "var(--accent-primary)" }}
              >
                Button
              </span>
            </div>
          </div>
        )}
      </div>

      <StepFooter
        onBack={onPrev}
        onSkip={handleContinue}
        skipLabel="Skip"
        onNext={handleContinue}
        nextLabel="Continue"
      />
    </div>
  );
}
