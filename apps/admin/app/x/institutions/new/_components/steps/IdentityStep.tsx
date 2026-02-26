"use client";

import { useState, useRef, useCallback } from "react";
import { Loader2, Check, Globe, Sparkles } from "lucide-react";
import { TypePicker } from "@/components/shared/TypePicker";
import { FieldHint } from "@/components/shared/FieldHint";
import { WIZARD_HINTS } from "@/lib/wizard-hints";
import { StepFooter } from "@/components/wizards/StepFooter";
import type { StepRenderProps } from "@/components/wizards/types";

interface UrlImportResult {
  name?: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const URL_STOP_WORDS = new Set(["the", "a", "an", "of", "and", "or", "school", "high", "primary", "junior", "senior", "academy", "st", "saint"]);

function suggestTypeFromName(name: string): string | null {
  if (!name.trim()) return null;
  if (/school|primary|secondary|infant|junior|nursery|prep|sixth.?form/i.test(name)) return "school";
  if (/hospital|clinic|health|care|nhs|therapy|medical|dental/i.test(name)) return "healthcare";
  if (/charity|foundation|community|trust|wellbeing|centre|center|society|association/i.test(name)) return "community";
  if (/gym|fitness|sport|athletics|personal.train/i.test(name)) return "coaching";
  if (/training|learning|workshop|development/i.test(name)) return "training";
  if (/ltd|limited|consulting|solutions|group|agency|corp|company|plc/i.test(name)) return "corporate";
  return null;
}

function nameToUrlSuggestions(name: string, typeSlug?: string | null): string[] {
  const clean = name.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const full = clean.replace(/\s+/g, "");
  const short = clean.split(/\s+/).filter((w) => !URL_STOP_WORDS.has(w)).slice(0, 2).join("");
  const base = short || full;
  if (!base) return [];

  // Detect type from name keywords + typeSlug
  const isSchool = typeSlug === "school" || /school|primary|junior|secondary|infant|prep|nursery/i.test(name);
  const isHigher = /university|college|polytechnic/i.test(name) || typeSlug === "higher";
  const isCharity = /trust|foundation|charity|association|society/i.test(name) || typeSlug === "community";
  const isCorporate = typeSlug === "corporate" || typeSlug === "training" || typeSlug === "coaching" || typeSlug === "healthcare";

  if (isSchool) {
    // UK schools: {name}.sch.uk is the pattern (real domains add LA: name.borough.sch.uk)
    return [`${base}.sch.uk`, `${base}.co.uk`];
  }
  if (isHigher) {
    return [`${base}.ac.uk`, `${base}.co.uk`];
  }
  if (isCharity) {
    return [`${base}.org.uk`, `${base}.co.uk`];
  }
  if (isCorporate) {
    const out = [`${full}.com`];
    if (short && short !== full) out.push(`${short}.co.uk`);
    return out.slice(0, 3);
  }
  // Generic fallback — .com first, .co.uk second
  const out: string[] = [];
  if (full) out.push(`${full}.com`);
  if (short && short !== full) out.push(`${short}.co.uk`);
  return out.slice(0, 3);
}

export function IdentityStep({ getData, setData, onNext }: StepRenderProps) {
  const [name, setName] = useState(getData<string>("institutionName") ?? "");
  const [typeSlug, setTypeSlug] = useState<string | null>(getData<string>("typeSlug") ?? null);
  const [typeId, setTypeId] = useState<string | undefined>(getData<string>("typeId") ?? undefined);
  const [websiteUrl, setWebsiteUrl] = useState(getData<string>("websiteUrl") ?? "");
  const [urlImporting, setUrlImporting] = useState(false);
  const [urlImportResult, setUrlImportResult] = useState<UrlImportResult | null>(
    getData<UrlImportResult>("urlImportResult") ?? null,
  );
  const urlImportAttempted = useRef(!!urlImportResult);

  const slug = toSlug(name);
  const suggestedType = !typeSlug ? suggestTypeFromName(name) : null;
  const effectiveType = typeSlug ?? suggestedType;
  const canContinue = name.trim().length > 0 && !!effectiveType;
  const urlSuggestions = name.length >= 5 && !websiteUrl.trim() && !urlImportResult
    ? nameToUrlSuggestions(name, effectiveType)
    : [];

  const handleUrlChipClick = (url: string) => {
    urlImportAttempted.current = false; // allow fresh import from chip
    setWebsiteUrl(url);
    handleUrlImport(url);
  };

  const handleUrlImport = useCallback(
    async (url: string) => {
      if (!url.trim() || urlImportAttempted.current) return;
      urlImportAttempted.current = true;
      setUrlImporting(true);
      try {
        const res = await fetch("/api/institutions/url-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim() }),
        });
        const data = await res.json();
        if (data.ok && data.meta) {
          setUrlImportResult(data.meta);
          setData("urlImportResult", data.meta);
          if (!name.trim() && data.meta.name) setName(data.meta.name);
          // Pre-fill branding data bag so BrandingStep initialises from them
          if (data.meta.logoUrl) setData("logoUrl", data.meta.logoUrl);
          if (data.meta.primaryColor) setData("primaryColor", data.meta.primaryColor);
          if (data.meta.secondaryColor) setData("secondaryColor", data.meta.secondaryColor);
        }
      } catch {
        // Silently fail — manual entry fallback
      } finally {
        setUrlImporting(false);
      }
    },
    [name, setData],
  );

  const handleNext = () => {
    setData("institutionName", name.trim());
    setData("typeSlug", effectiveType);
    if (typeId) setData("typeId", typeId);
    setData("websiteUrl", websiteUrl);
    onNext();
  };

  return (
    <div className="iw-name-row">
      <div>
        <FieldHint label="Institution Type" hint={WIZARD_HINTS["institution.type"]} />
        <TypePicker
          value={typeSlug}
          suggestedValue={suggestedType}
          onChange={(slug, id) => {
            setTypeSlug(slug);
            setTypeId(id);
          }}
        />
      </div>

      <div>
        <FieldHint label="Name" hint={WIZARD_HINTS["institution.name"]} />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Oakwood Primary School"
          className="hf-input"
        />
        {slug && <p className="iw-slug-preview">{slug}</p>}
      </div>

      <div className="iw-url-row">
        <FieldHint label="Website (optional)" hint={WIZARD_HINTS["institution.website"]} />
        <div className="iw-color-row">
          <Globe size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <input
            type="url"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            onBlur={() => {
              if (websiteUrl.trim()) handleUrlImport(websiteUrl);
            }}
            placeholder="https://www.school.co.uk"
            className="hf-input"
            style={{ flex: 1 }}
          />
        </div>
        {urlSuggestions.length > 0 && (
          <div className="hf-mt-xs">
            <p className="hf-ai-inline-hint hf-mb-xs">
              <Sparkles size={11} /> Try:
            </p>
            <div className="hf-suggestion-chips">
              {urlSuggestions.map((url) => (
                <button key={url} type="button" className="hf-suggestion-chip" onClick={() => handleUrlChipClick(url)}>
                  🔗 {url}
                </button>
              ))}
            </div>
          </div>
        )}
        {urlImporting && (
          <div className="iw-url-importing">
            <Loader2 size={14} className="hf-spinner" />
            Importing from website...
          </div>
        )}
        {urlImportResult && !urlImporting && (
          <div className="iw-url-result">
            <Check size={14} />
            Imported{urlImportResult.name ? `: ${urlImportResult.name}` : ""}
            {urlImportResult.primaryColor ? ` · colours detected` : ""}
          </div>
        )}
      </div>

      <StepFooter onNext={handleNext} nextLabel="Continue" nextDisabled={!canContinue} />
    </div>
  );
}
