"use client";

/**
 * Acronym — renders text with a hover/focus tooltip explaining what the
 * acronym means. Use anywhere FC / LR / GRA / P / OUT-NN / SKILL-NN /
 * tier-name etc. would otherwise read as raw jargon to an educator.
 *
 * Pure native `<abbr>` semantics + a `title` attribute (universal hover),
 * plus a CSS underline cue so educators know it's interactive. No
 * external tooltip library — keeps the bundle small and the markup
 * accessible by default.
 *
 * Lookup defaults to `lib/banding/glossary.ts`; consumers can pass
 * an explicit `title` / `description` to override.
 */
import { lookupAcronym } from "@/lib/banding/glossary";

interface AcronymProps {
  /** The literal text to show (e.g. "FC", "SKILL-01"). */
  children: string;
  /** Override the full expansion (skip glossary lookup). */
  title?: string;
  /** Override the description (skip glossary lookup). */
  description?: string;
  /** Style hint — defaults to dotted underline. */
  className?: string;
}

export function Acronym({
  children,
  title,
  description,
  className,
}: AcronymProps) {
  const entry = lookupAcronym(children);
  const expanded = title ?? entry?.full ?? children;
  const desc = description ?? entry?.description;
  const tooltipBody = desc ? `${expanded} — ${desc}` : expanded;
  return (
    <abbr
      className={className ?? "hf-acronym"}
      title={tooltipBody}
    >
      {children}
    </abbr>
  );
}
