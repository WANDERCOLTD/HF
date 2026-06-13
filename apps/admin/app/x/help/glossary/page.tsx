import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import "./help-glossary.css";

/**
 * Glossary — Courses, Skills, LOs, TPs, Mastery.
 *
 * Single source of truth for the educator + engineer vocabulary used across
 * course design, skill measurement, and learner progress. Maintained as
 * `docs/glossary-skills-mastery.md`; this page reads the markdown at request
 * time so any commit to the doc is live immediately — no rebuild needed.
 *
 * Surfaced in the help bank at `/x/help/glossary` and indexed by Cmd+K via
 * `lib/help/page-help.ts`.
 *
 * Auth: open to all signed-in roles (vocabulary, not data).
 */

export const dynamic = "force-dynamic";

const GLOSSARY_PATH = "docs/glossary-skills-mastery.md";

function loadGlossary(): { content: string; lastModified: string } {
  const repoRoot = resolve(process.cwd(), "..", "..");
  const fullPath = resolve(repoRoot, GLOSSARY_PATH);
  const content = readFileSync(fullPath, "utf-8");
  // Strip the front-matter callout block so the page header doesn't double up.
  return { content, lastModified: new Date().toISOString().slice(0, 10) };
}

export default function HelpGlossaryPage() {
  const { content } = loadGlossary();

  return (
    <div className="hf-page">
      <header className="hf-page-header">
        <h1 className="hf-page-title">Glossary — Skills, LOs, TPs, Mastery</h1>
        <p className="hf-page-subtitle">
          Canonical vocabulary across course design, skill measurement, and
          learner progress. Maintained in{" "}
          <code>{GLOSSARY_PATH}</code>; this page reflects whatever's on the
          current branch.
        </p>
      </header>
      <article className="hf-help-glossary-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </article>
    </div>
  );
}
