// DisclosureContentPort implementation — reads MDX copy from
// lib/intake/copy/*.mdx, parses frontmatter, returns DisclosureContent
// + contentHash bound to the body.
//
// Production safety belt: refuses to deliver DRAFT-status copy when
// NODE_ENV === 'production'. Throws DraftCopyInProductionError so the
// caller (DeliveryPort) sees an audit-defensible failure.
//
// Phase 1 storage: filesystem only. Phase 2+ may add a DB "active
// version" pointer per ADR § "Copy + version storage management".

import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { canonicalJSON } from "../tallyseal";
import type { DisclosureContent } from "../tallyseal";

const COPY_DIR = join(process.cwd(), "lib", "intake", "copy");

// ── Frontmatter shape (kept in step with lib/intake/copy/*.mdx) ────
export interface DisclosureCopyMeta {
  readonly requirementId: string;
  readonly regulation: string;
  readonly article: string;
  readonly version: string;
  readonly status: "DRAFT" | "RC" | "RELEASED";
  readonly effective: string;
  readonly controller: string;
  readonly controllerContact: string;
  readonly locale: string;
  readonly targetWords?: string;
  readonly links?: ReadonlyArray<{ label: string; href: string }>;
}

export interface DisclosureCopyEntry {
  readonly meta: DisclosureCopyMeta;
  readonly body: string;
  readonly content: DisclosureContent;
  readonly contentHash: string;
}

export class DraftCopyInProductionError extends Error {
  constructor(public readonly requirementId: string, public readonly version: string) {
    super(
      `Refusing to deliver DRAFT disclosure copy in production: ` +
        `${requirementId} v${version}. Counsel must sign off + the file ` +
        `must be re-versioned (remove -DRAFT, bump to -rc.N or release ` +
        `version) before NODE_ENV=production may deliver it.`,
    );
    this.name = "DraftCopyInProductionError";
  }
}

// ── Public port ─────────────────────────────────────────────────────

/**
 * Load a single disclosure copy entry by its `requirementId`. Looks
 * for the highest-version matching file in lib/intake/copy/.
 */
export async function loadDisclosureCopy(
  requirementId: string,
  locale = "en",
): Promise<DisclosureCopyEntry> {
  const allFiles = await readdir(COPY_DIR);
  const matches = allFiles
    .filter((f) => f.endsWith(".mdx") && fileMatchesRequirement(f, requirementId));
  if (matches.length === 0) {
    throw new Error(
      `No disclosure copy file found for requirementId="${requirementId}" in ${COPY_DIR}`,
    );
  }
  // Pick the highest-version file (lexicographic on filename is enough
  // for the spike — semver-aware ordering belongs in a Phase 2 pointer
  // store). Tied versions: "-rc.N" > "-DRAFT" alphabetically, which is
  // also the right precedence.
  matches.sort();
  const filename = matches[matches.length - 1];
  return loadDisclosureCopyFile(filename, locale);
}

/**
 * Variant: load by absolute filename when caller already knows which
 * version it wants (used by the apply-migrations-time content audit).
 */
export async function loadDisclosureCopyFile(
  filename: string,
  locale = "en",
): Promise<DisclosureCopyEntry> {
  const path = join(COPY_DIR, filename);
  const raw = await readFile(path, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  if (meta.status === "DRAFT" && process.env.NODE_ENV === "production") {
    throw new DraftCopyInProductionError(meta.requirementId, meta.version);
  }
  if (meta.locale !== locale) {
    // Phase 1: single locale (en). When we ship more, locale-filter
    // here before returning the highest-version-of-this-locale.
  }
  const content: DisclosureContent = {
    text: body,
    format: "markdown",
    locale: meta.locale,
  };
  const contentHash = hashCopy(body, meta);
  return { meta, body, content, contentHash };
}

/**
 * Stable SHA-256 over canonical-JSON of (body + version + locale).
 * Distinct from tallyseal's `computeContentHash` (which is shaped for
 * tallyseal Event records). We use canonical-JSON canonicalisation
 * for byte-stable hashing across platforms.
 */
function hashCopy(body: string, meta: DisclosureCopyMeta): string {
  const canon = canonicalJSON(canonicaliseForHash(body, meta));
  return createHash("sha256").update(canon).digest("hex");
}

// ── Internals ──────────────────────────────────────────────────────

function fileMatchesRequirement(filename: string, requirementId: string): boolean {
  // Filename convention: <slug>.<semver>(-DRAFT|-rc.N)?.mdx where slug
  // is the requirementId with dots → dashes (e.g. gdpr.art13.privacy →
  // gdpr-art13-privacy). We accept that exact transform here.
  const slug = requirementId.replace(/\./g, "-");
  return filename.startsWith(`${slug}.`);
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

function parseFrontmatter(raw: string): {
  meta: DisclosureCopyMeta;
  body: string;
} {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error("Disclosure copy file missing YAML frontmatter delimiters");
  }
  const yamlBlock = match[1];
  const body = match[2].trim();
  const meta = parseYamlFlat(yamlBlock);
  return { meta, body };
}

// Tiny YAML subset parser — supports the flat key:value (+ array of
// objects under `links:`) shape our frontmatter uses. NOT a general
// YAML implementation; if the frontmatter gains nesting beyond
// `links:`, switch to a real YAML parser (or MDX-aware loader).
function parseYamlFlat(yamlBlock: string): DisclosureCopyMeta {
  const out: Record<string, unknown> = {};
  const lines = yamlBlock.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const flat = line.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!flat) {
      i++;
      continue;
    }
    const key = flat[1];
    const value = flat[2].trim();
    if (key === "links" && value === "") {
      // Array of objects
      const links: Array<{ label: string; href: string }> = [];
      i++;
      while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
        const item: Record<string, string> = {};
        // First `- key: value`
        const first = lines[i].match(/^\s+-\s+([a-zA-Z]+)\s*:\s*(.*)$/);
        if (first) item[first[1]] = stripQuotes(first[2]);
        i++;
        while (i < lines.length && /^\s{4,}[a-zA-Z]+\s*:/.test(lines[i])) {
          const cont = lines[i].match(/^\s+([a-zA-Z]+)\s*:\s*(.*)$/);
          if (cont) item[cont[1]] = stripQuotes(cont[2]);
          i++;
        }
        if (item.label && item.href) {
          links.push({ label: item.label, href: item.href });
        }
      }
      out.links = links;
    } else {
      out[key] = stripQuotes(value);
      i++;
    }
  }
  return out as unknown as DisclosureCopyMeta;
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function canonicaliseForHash(
  body: string,
  meta: DisclosureCopyMeta,
): Record<string, string> {
  // Hash binds (body + version + locale). Bumping version forces a new
  // hash even when body is identical — that's intentional: callers
  // verifying consent receipts should see the hash change on version
  // bump alone, so consent under an older effective-date is detectable.
  return {
    body: body.replace(/\r\n/g, "\n").trim(),
    version: meta.version,
    locale: meta.locale,
  };
}
