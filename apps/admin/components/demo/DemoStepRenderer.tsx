"use client";

import type { DemoStepContent } from "@/lib/demo/types";
import { ScreenshotViewer } from "./ScreenshotViewer";

interface DemoStepRendererProps {
  content: DemoStepContent;
  /** Called when user clicks a highlighted annotation (advances to next step) */
  onAnnotationClick?: () => void;
}

export function DemoStepRenderer({ content, onAnnotationClick }: DemoStepRendererProps) {
  switch (content.type) {
    case "screenshot":
      return <ScreenshotViewer content={content} onAnnotationClick={onAnnotationClick} />;

    case "markdown":
      return <MarkdownContent body={content.body} />;

    case "split":
      return (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 24,
            width: "100%",
            maxWidth: 1100,
            margin: "0 auto",
          }}
          className="demo-split-view"
        >
          <div>
            <DemoStepRenderer content={content.left} onAnnotationClick={onAnnotationClick} />
          </div>
          <div>
            <DemoStepRenderer content={content.right} onAnnotationClick={onAnnotationClick} />
          </div>

          <style jsx>{`
            @media (max-width: 768px) {
              .demo-split-view {
                grid-template-columns: 1fr !important;
              }
            }
          `}</style>
        </div>
      );

    default:
      return null;
  }
}

function MarkdownContent({ body }: { body: string }) {
  // Simple markdown rendering — handles headers, bold, bullets, links, code
  const html = renderSimpleMarkdown(body);

  return (
    <div
      style={{
        maxWidth: 700,
        margin: "0 auto",
        padding: "20px 0",
      }}
    >
      <div
        className="demo-markdown"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <style jsx>{`
        .demo-markdown :global(h1) {
          font-size: 28px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0 0 16px 0;
          line-height: 1.3;
        }
        .demo-markdown :global(h2) {
          font-size: 20px;
          font-weight: 600;
          color: var(--text-primary);
          margin: 24px 0 12px 0;
        }
        .demo-markdown :global(h3) {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-secondary);
          margin: 20px 0 8px 0;
        }
        .demo-markdown :global(p) {
          font-size: 15px;
          color: var(--text-secondary);
          line-height: 1.6;
          margin: 0 0 12px 0;
        }
        .demo-markdown :global(ul),
        .demo-markdown :global(ol) {
          padding-left: 24px;
          margin: 8px 0 16px 0;
        }
        .demo-markdown :global(li) {
          font-size: 15px;
          color: var(--text-secondary);
          line-height: 1.6;
          margin-bottom: 6px;
        }
        .demo-markdown :global(strong) {
          color: var(--text-primary);
          font-weight: 600;
        }
        .demo-markdown :global(code) {
          background: var(--surface-secondary);
          border: 1px solid var(--border-default);
          border-radius: 4px;
          padding: 2px 6px;
          font-size: 13px;
          font-family: var(--font-mono, monospace);
        }
        .demo-markdown :global(em) {
          font-style: italic;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}

/**
 * Minimal markdown to HTML renderer.
 * Handles: h1-h3, bold, italic, bullets, numbered lists, code, links, horizontal rules.
 * Not a full parser — sufficient for demo content.
 *
 * SECURITY: escapes HTML in the input BEFORE applying markdown transforms so a
 * malicious demo JSON body cannot inject raw HTML / scripts via the
 * `dangerouslySetInnerHTML` consumer at line 69. Without the escape, a body
 * like `"<script>alert(1)</script>"` would render as a live script tag (the
 * markdown transforms are regex-replace only and don't escape input). Demo
 * content is in-repo + code-reviewed today, so this was a latent risk; the
 * escape closes it before demo content ever becomes admin-editable via UI.
 * Audit follow-up to HF-M, "what else can we do" sweep.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSimpleMarkdown(md: string): string {
  // Escape before any markdown transform — inlineFormat below treats `**` and
  // backticks as syntax but does NOT escape angle brackets.
  md = escapeHtml(md);
  const lines = md.split("\n");
  const result: string[] = [];
  let inList = false;
  let listType: "ul" | "ol" | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Close list if not a list item
    if (inList && !line.match(/^(\s*[-*]\s|^\s*\d+\.\s)/)) {
      result.push(`</${listType}>`);
      inList = false;
      listType = null;
    }

    // Headers
    if (line.startsWith("### ")) {
      result.push(`<h3>${inlineFormat(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      result.push(`<h2>${inlineFormat(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("# ")) {
      result.push(`<h1>${inlineFormat(line.slice(2))}</h1>`);
      continue;
    }

    // Horizontal rule
    if (line.match(/^---+$/)) {
      result.push("<hr />");
      continue;
    }

    // Unordered list
    if (line.match(/^\s*[-*]\s/)) {
      if (!inList || listType !== "ul") {
        if (inList) result.push(`</${listType}>`);
        result.push("<ul>");
        inList = true;
        listType = "ul";
      }
      result.push(`<li>${inlineFormat(line.replace(/^\s*[-*]\s/, ""))}</li>`);
      continue;
    }

    // Ordered list
    if (line.match(/^\s*\d+\.\s/)) {
      if (!inList || listType !== "ol") {
        if (inList) result.push(`</${listType}>`);
        result.push("<ol>");
        inList = true;
        listType = "ol";
      }
      result.push(`<li>${inlineFormat(line.replace(/^\s*\d+\.\s/, ""))}</li>`);
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      continue;
    }

    // Paragraph
    result.push(`<p>${inlineFormat(line)}</p>`);
  }

  if (inList) {
    result.push(`</${listType}>`);
  }

  return result.join("\n");
}

function inlineFormat(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}
