// Audit follow-up to HF-M (2026-06-12) — pins the HTML-escape in the
// `renderSimpleMarkdown` helper used by `components/demo/DemoStepRenderer.tsx`
// (which feeds `dangerouslySetInnerHTML`).
//
// Pre-fix: a malicious demo body like `<script>alert(1)</script>` rendered as
// a live script tag because `inlineFormat` is regex-replace only and doesn't
// escape input.
// Post-fix: the body is HTML-escaped BEFORE the markdown transforms; angle
// brackets become &lt;/&gt;.
//
// Demo content is in-repo and code-reviewed today, so the pre-fix risk was
// latent. The escape closes it before demo content ever becomes admin-editable.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Extract the two functions from the source file at runtime — they aren't
// exported, but the test asserts the static text behaviour.
const source = readFileSync(
  resolve(__dirname, "../../components/demo/DemoStepRenderer.tsx"),
  "utf8",
);

describe("demo markdown — XSS escape", () => {
  it("source defines an `escapeHtml` helper that escapes < > & \" '", () => {
    expect(source).toContain('escapeHtml(s: string)');
    expect(source).toMatch(/replace\(\/&\/g, ["']&amp;["']\)/);
    expect(source).toMatch(/replace\(\/<\/g, ["']&lt;["']\)/);
    expect(source).toMatch(/replace\(\/>\/g, ["']&gt;["']\)/);
    expect(source).toMatch(/replace\(\/"\/g, ["']&quot;["']\)/);
    expect(source).toMatch(/replace\(\/'\/g, ["']&#39;["']\)/);
  });

  it("renderSimpleMarkdown calls escapeHtml BEFORE any markdown transform", () => {
    // The call must come before the lines split + the per-line transforms.
    const renderIdx = source.indexOf("function renderSimpleMarkdown");
    const escapeCallIdx = source.indexOf("md = escapeHtml(md)", renderIdx);
    const splitIdx = source.indexOf("md.split(", renderIdx);
    expect(renderIdx).toBeGreaterThan(0);
    expect(escapeCallIdx).toBeGreaterThan(renderIdx);
    expect(splitIdx).toBeGreaterThan(escapeCallIdx);
  });

  it("escapeHtml is referenced exactly once in renderSimpleMarkdown body", () => {
    // Double-application would double-escape; missing application would leak.
    const matches = source.match(/escapeHtml\(/g) ?? [];
    // 2 = the function declaration line + the single call site.
    expect(matches.length).toBe(2);
  });
});
