import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { prisma } from "@/lib/prisma";
import { resolvePlaybookId } from "@/lib/enrollment/resolve-playbook";

// =============================================================
// TYPES
// =============================================================

export interface ImportConflict {
  /** Unique key for this conflict (e.g., "phone:+447768111111") */
  conflictKey: string;
  /** Type of match that caused the conflict */
  matchType: "phone" | "tag";
  /** The matching value (phone number or tag) */
  matchValue: string;
  /** Info about the existing caller in the database */
  existingCaller: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    callCount: number;
  };
  /** Info about the incoming caller from the transcript */
  incomingCaller: {
    name: string | null;
    phone: string | null;
    callCount: number;
    firstTranscriptPreview: string;
  };
  /** User's resolution choice */
  resolution?: "merge" | "create_new" | "skip";
}

function expandTilde(p: string): string {
  const t = (p || "").trim();
  if (!t) return "";
  if (t === "~") return os.homedir();
  if (t.startsWith("~/") || t.startsWith("~\\")) {
    return path.join(os.homedir(), t.slice(2));
  }
  return t;
}

function getKbRoot(): string {
  const envRaw = process.env.HF_KB_PATH || "";
  const env = expandTilde(envRaw);
  if (env && env.trim()) return path.resolve(env.trim());
  return path.resolve(path.join(os.homedir(), "hf_kb"));
}

function getTranscriptsRawDir(): string {
  return path.join(getKbRoot(), "sources", "transcripts", "raw");
}

interface VAPICall {
  id: string;
  transcript: string;
  summary?: string;
  customer: { name?: string; number?: string } | null | string;
  startedAt: string | null;
  endedAt: string | null;
  status?: string;
  endedReason?: string;
  messages?: any[];
  createdAt: string;
}

/**
 * Check if a string looks like a tag/identifier rather than a real name
 * Tags are typically: ALL_CAPS_WITH_UNDERSCORES, CamelCaseIdentifiers, or contain numbers
 */
function looksLikeTag(name: string): boolean {
  if (!name) return true;
  // All caps with underscores (e.g., WNF_STUDENT, TEST_USER)
  if (/^[A-Z][A-Z0-9_]+$/.test(name)) return true;
  // Contains underscores or is all caps
  if (name.includes('_')) return true;
  // Contains numbers in weird places
  if (/[0-9]/.test(name)) return true;
  return false;
}

/**
 * Extract caller name from transcript content
 * Looks for patterns where the caller introduces themselves or AI greets them
 */
function extractNameFromTranscript(transcript: string): string | null {
  if (!transcript) return null;

  // Blacklist of common words that aren't names
  const blacklist = new Set([
    'there', 'here', 'this', 'that', 'these', 'those',
    'thinking', 'doing', 'reading', 'writing', 'speaking',
    'first name', 'last name', 'first', 'last', 'name', 'user', 'caller',
    'yes', 'no', 'not', 'just', 'really', 'very', 'quite',
    'hi', 'hello', 'hey', 'well', 'okay', 'ok', 'sure'
  ]);

  // Helper to validate a potential name
  const isValidName = (name: string): boolean => {
    if (!name || name.length < 2) return false;
    const nameLower = name.toLowerCase();
    if (blacklist.has(nameLower)) return false;
    if (looksLikeTag(name)) return false;
    // Must start with capital and be mostly letters
    if (!/^[A-Z][a-z]+/.test(name)) return false;
    return true;
  };

  // Look at first 1500 chars to find name introduction
  const searchText = transcript.slice(0, 1500);

  // Pattern 1: AI greets by name - "AI: Hi, NAME" or "AI: Hello, NAME"
  // Requires comma after greeting to distinguish from "Hi. First name" (asking for name)
  // Only if NAME looks like a real name (not a tag)
  const hiMatch = searchText.match(/AI:\s*(?:Hi|Hello|Hey),\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\./);
  if (hiMatch) {
    const name = hiMatch[1].trim();
    if (isValidName(name)) return name;
  }

  // Pattern 2: User introduces themselves - "My name is NAME" or "I'm NAME"
  const introPatterns = [
    /User:\s*.*?\bmy name is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i,
    /User:\s*.*?\bI'm\s+([A-Z][a-z]+)\b/,
    /User:\s*.*?\bI am\s+([A-Z][a-z]+)\b/i,
    /User:\s*.*?\bThis is\s+([A-Z][a-z]+)\s+(?:speaking|here)/i,
    /User:\s*.*?\bcall me\s+([A-Z][a-z]+)\b/i,
  ];

  for (const pattern of introPatterns) {
    const match = searchText.match(pattern);
    if (match) {
      const name = match[1].trim();
      if (isValidName(name)) return name;
    }
  }

  return null;
}

/**
 * Parse a SIMPLE text transcript format:
 * ```
 * Caller: Paul
 * Number: +44 7768 486464
 * Call: 1
 *
 * AI: Hi
 * Paul: Hi
 * AI: Ready to learn?
 * Paul: Yes
 * ```
 *
 * Lines are prefixed with speaker name followed by colon.
 * "AI:" indicates the assistant, anything else is the user.
 */
function parseSimpleTranscript(content: string, filename: string): VAPICall | null {
  try {
    // Quick check: if this looks like VAPI format, bail out early
    // VAPI format has "Transcript" header and "Assistant"/"User" on their own lines
    if (content.includes("\nTranscript\n") || content.includes("\nTranscript\r\n")) {
      return null; // Let parseTextTranscript handle it
    }
    if (/\n(Assistant|User)\r?\n/i.test(content)) {
      return null; // VAPI format uses standalone speaker labels
    }

    const lines = content.split("\n").map((l) => l.trim());

    // Extract metadata from header
    let callerName: string | null = null;
    let phone: string | null = null;
    let _callNumber: number | null = null; // Parsed but not yet used (for future: override callSequence)
    let dialogueStartIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Caller: NAME
      const callerMatch = line.match(/^Caller:\s*(.+)/i);
      if (callerMatch) {
        callerName = callerMatch[1].trim();
        continue;
      }

      // Number: +44... or Phone: +44... or Phone Number: +44...
      const phoneMatch = line.match(/^(?:Phone\s*)?Number:\s*\+?\s*(.+)/i);
      if (phoneMatch) {
        phone = phoneMatch[1].replace(/\s/g, "");
        continue;
      }

      // Call: N
      const callMatch = line.match(/^Call:\s*(\d+)/i);
      if (callMatch) {
        _callNumber = parseInt(callMatch[1], 10);
        continue;
      }

      // Empty line or first dialogue line marks start of transcript
      if (line === "") {
        dialogueStartIndex = i + 1;
        continue;
      }

      // If we hit a line with "Speaker: text" format, this is dialogue start
      if (line.includes(":") && !line.match(/^(Caller|Number|Phone|Call):/i)) {
        dialogueStartIndex = i;
        break;
      }
    }

    // Parse dialogue lines
    const transcriptLines: string[] = [];
    for (let i = dialogueStartIndex; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      // Match "Speaker: text" format
      const dialogueMatch = line.match(/^([^:]+):\s*(.*)$/);
      if (dialogueMatch) {
        const speaker = dialogueMatch[1].trim();
        const text = dialogueMatch[2].trim();

        if (!text) continue;

        // AI/Assistant -> AI:, anything else -> User:
        if (speaker.toLowerCase() === "ai" || speaker.toLowerCase() === "assistant") {
          transcriptLines.push(`AI: ${text}`);
        } else {
          transcriptLines.push(`User: ${text}`);
        }
      }
    }

    if (transcriptLines.length === 0) return null;

    const transcript = transcriptLines.join("\n");

    // Generate ID from filename or timestamp
    const logIdMatch = filename.match(/Log ID ([0-9a-f-]+)/i);
    const logId = logIdMatch
      ? logIdMatch[1]
      : `txt-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Normalize phone number
    let normalizedPhone = phone;
    if (phone) {
      // Remove spaces and ensure + prefix
      normalizedPhone = phone.replace(/\s/g, "");
      if (!normalizedPhone.startsWith("+")) {
        // UK number starting with 0 -> +44
        if (normalizedPhone.startsWith("0")) {
          normalizedPhone = "+44" + normalizedPhone.slice(1);
        } else {
          normalizedPhone = "+" + normalizedPhone;
        }
      }
    }

    return {
      id: logId,
      transcript,
      summary: "",
      customer: normalizedPhone
        ? { number: normalizedPhone, name: callerName || undefined }
        : callerName
          ? { name: callerName }
          : null,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      status: "ended",
      endedReason: "completed",
      messages: [],
      createdAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error(`Failed to parse simple transcript: ${filename}`, e);
    return null;
  }
}

/**
 * Parse a plain text transcript file into a call object
 *
 * Format expected (VAPI export style):
 * ```
 * Phone Number: +07768 484848
 * Caller: WNF_STUDENT
 * Call: 1
 *
 * Transcript
 * [first message - implicitly AI]
 * [timestamp]
 * Assistant
 * [message text]
 * [timestamp]
 * User
 * [message text]
 * ...
 * ```
 */
function parseTextTranscript(content: string, filename: string): VAPICall | null {
  try {
    // Extract log ID from filename (e.g., "Session 1 - Log ID 019bf58d-d83d-744f-abf0-6b514299d5f3.txt")
    const logIdMatch = filename.match(/Log ID ([0-9a-f-]+)/i);
    const logId = logIdMatch ? logIdMatch[1] : `txt-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Extract phone number
    const phoneMatch = content.match(/Phone Number:\s*\+?\s*([0-9\s]+)/i);
    const phone = phoneMatch ? phoneMatch[1].replace(/\s/g, "") : null;

    // Extract caller name
    const callerMatch = content.match(/Caller:\s*(.+)/i);
    const callerName = callerMatch ? callerMatch[1].trim() : null;

    // Find where transcript starts
    // Look for explicit "Transcript" header first, otherwise find conversation start
    // after metadata block (first double-newline or first standalone Assistant/User label)
    let transcriptContent: string;
    const transcriptStart = content.indexOf("Transcript");
    if (transcriptStart !== -1) {
      transcriptContent = content.slice(transcriptStart + "Transcript".length).trim();
    } else {
      // No "Transcript" header - find end of metadata block
      // Metadata lines: "Phone Number:", "Caller:", "Call:"
      // Conversation starts after the last metadata line + blank line(s)
      const metaEndMatch = content.match(/^(?:(?:Phone\s*Number|Caller|Call):.*\n)+\s*\n/im);
      if (metaEndMatch) {
        transcriptContent = content.slice(metaEndMatch.index! + metaEndMatch[0].length).trim();
      } else {
        return null;
      }
    }

    // Parse the transcript by finding speaker labels and extracting text between them
    // The format is: [text][timestamp][SpeakerLabel][text][timestamp][SpeakerLabel]...
    // Where the first text block has no preceding label (implicitly AI)

    const lines: string[] = [];

    // Regex to match timestamps like "2:28:17 PM(+00:24.82)"
    const timestampRegex = /\d+:\d+:\d+\s*(AM|PM)\s*\(\+[\d.:]+\)/gi;

    // Split by speaker labels, keeping the labels
    const parts = transcriptContent.split(/\n(Assistant|User)\n/);

    // First part is the initial AI message (before any label)
    if (parts.length > 0 && parts[0].trim()) {
      const firstText = parts[0].replace(timestampRegex, "").trim();
      if (firstText) {
        lines.push(`AI: ${firstText}`);
      }
    }

    // Process remaining parts: [label, text, label, text, ...]
    for (let i = 1; i < parts.length; i += 2) {
      const label = parts[i];
      const text = parts[i + 1];

      if (!text) continue;

      const cleanText = text.replace(timestampRegex, "").trim();
      if (!cleanText) continue;

      if (label === "Assistant") {
        lines.push(`AI: ${cleanText}`);
      } else if (label === "User") {
        lines.push(`User: ${cleanText}`);
      }
    }

    if (lines.length === 0) return null;

    const transcript = lines.join("\n");

    return {
      id: logId,
      transcript,
      summary: "",
      customer: phone
        ? {
            number: `+${phone.startsWith("0") ? "44" + phone.slice(1) : phone}`,
            name: callerName || undefined,
          }
        : callerName
        ? { name: callerName }
        : null,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      status: "ended",
      endedReason: "completed",
      messages: [],
      createdAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error(`Failed to parse text file: ${filename}`, e);
    return null;
  }
}

/**
 * Scan a directory recursively for transcript files (.json, .txt)
 */
async function scanTranscriptsDir(dir: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const subFiles = await scanTranscriptsDir(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        const lowerName = entry.name.toLowerCase();
        if (lowerName.endsWith(".json") || lowerName.endsWith(".txt")) {
          files.push(fullPath);
        }
      }
    }
  } catch {
    // Directory doesn't exist or not accessible
  }

  return files;
}

/**
 * Parse files into grouped calls by caller
 * Shared logic between preview and import
 */
interface ParsedCallerGroup {
  callerKey: string;
  phone: string | null;
  callerTag: string | null;
  callerName: string | null;
  calls: VAPICall[];
}

function parseFilesToCallerGroups(
  filesToProcess: Array<{ content: string; filename: string }>
): { groups: ParsedCallerGroup[]; errors: string[] } {
  const errors: string[] = [];
  const callsByCaller = new Map<string, { calls: VAPICall[]; phone: string | null; callerTag: string | null }>();

  for (const { content, filename } of filesToProcess) {
    try {
      const isJson = filename.toLowerCase().endsWith(".json");
      let calls: VAPICall[] = [];

      if (isJson) {
        const json = JSON.parse(content);
        calls = Array.isArray(json) ? json : (json.calls || [json]);
      } else {
        let call = parseSimpleTranscript(content, filename);
        if (!call) {
          call = parseTextTranscript(content, filename);
        }
        if (call) calls = [call];
      }

      const validCalls = calls.filter(
        (c) => c.transcript && c.transcript.trim().length > 0
      );

      for (const call of validCalls) {
        const customer = typeof call.customer === "object" ? call.customer : null;
        const phone = customer?.number || null;
        const callerTag = customer?.name || null;

        let key: string;
        if (phone && !phone.startsWith("unknown")) {
          key = `phone:${phone}`;
        } else if (callerTag && callerTag.trim()) {
          key = `tag:${callerTag.trim()}`;
        } else {
          key = `unknown-${call.id}`;
        }

        const existing = callsByCaller.get(key) || { calls: [], phone: null, callerTag: null };
        existing.calls.push(call);
        existing.phone = phone || existing.phone;
        existing.callerTag = callerTag || existing.callerTag;
        callsByCaller.set(key, existing);
      }
    } catch (e: any) {
      errors.push(`${filename}: ${e.message}`);
    }
  }

  // Convert to array and sort calls by date
  const groups: ParsedCallerGroup[] = [];
  for (const [callerKey, data] of callsByCaller) {
    data.calls.sort((a, b) => {
      const dateA = new Date(a.startedAt || a.createdAt).getTime();
      const dateB = new Date(b.startedAt || b.createdAt).getTime();
      return dateA - dateB;
    });

    // Determine caller name
    let callerName: string | null = null;
    const callerTag = data.callerTag;

    if (callerTag && !looksLikeTag(callerTag)) {
      callerName = callerTag;
    }
    if (!callerName) {
      callerName = extractNameFromTranscript(data.calls[0].transcript);
    }
    if (!callerName && callerTag && looksLikeTag(callerTag)) {
      callerName = callerTag
        .split('_')
        .map((part, i) => i === 0 ? part : part.charAt(0) + part.slice(1).toLowerCase())
        .join(' ');
    }
    if (!callerName) {
      if (data.phone && data.phone.length >= 4) {
        callerName = `Caller ${data.phone.slice(-4)}`;
      } else {
        callerName = `Caller ${Date.now().toString(36).slice(-4)}`;
      }
    }

    groups.push({
      callerKey,
      phone: data.phone,
      callerTag: data.callerTag,
      callerName,
      calls: data.calls,
    });
  }

  return { groups, errors };
}

/**
 * Detect conflicts between incoming callers and existing database callers
 */
async function detectConflicts(groups: ParsedCallerGroup[]): Promise<ImportConflict[]> {
  const conflicts: ImportConflict[] = [];

  for (const group of groups) {
    const { callerKey, phone, callerTag, callerName, calls } = group;

    // Build conditions to find existing caller
    const callerConditions: any[] = [];
    if (phone) callerConditions.push({ phone });
    if (callerTag) callerConditions.push({ externalId: `import-tag:${callerTag}` });

    if (callerConditions.length === 0) continue;

    const existingCaller = await prisma.caller.findFirst({
      where: { OR: callerConditions },
      include: {
        _count: { select: { calls: true } },
      },
    });

    if (!existingCaller) continue;

    // Check if there's a name mismatch (potential conflict)
    const existingName = existingCaller.name || "";
    const incomingName = callerName || "";

    // Conflict exists if:
    // 1. Names are different AND
    // 2. Neither is a fallback name (Caller XXXX, WNF Student, etc.)
    const existingIsFallback = !existingName ||
      existingName.startsWith('Caller ') ||
      looksLikeTag(existingName.replace(/\s/g, '_'));
    const incomingIsFallback = !incomingName ||
      incomingName.startsWith('Caller ') ||
      looksLikeTag(incomingName.replace(/\s/g, '_'));

    // Always show conflict if names differ significantly (unless both are fallbacks)
    const namesDiffer = existingName.toLowerCase() !== incomingName.toLowerCase();
    const shouldShowConflict = namesDiffer && !(existingIsFallback && incomingIsFallback);

    if (shouldShowConflict) {
      conflicts.push({
        conflictKey: callerKey,
        matchType: callerKey.startsWith("phone:") ? "phone" : "tag",
        matchValue: callerKey.startsWith("phone:") ? phone! : callerTag!,
        existingCaller: {
          id: existingCaller.id,
          name: existingCaller.name,
          phone: existingCaller.phone,
          email: existingCaller.email,
          callCount: existingCaller._count.calls,
        },
        incomingCaller: {
          name: callerName,
          phone,
          callCount: calls.length,
          firstTranscriptPreview: calls[0].transcript.slice(0, 200) + "...",
        },
      });
    }
  }

  return conflicts;
}

/**
 * @api POST /api/transcripts/import
 * @visibility public
 * @scope transcripts:import
 * @auth none
 * @tags transcripts
 * @description Imports transcript files into the database. Supports three modes: JSON body with filePaths, JSON body with fromKbPath auto-discovery, or FormData file uploads. Includes preview mode for conflict detection and user-controlled conflict resolution.
 * @body filePaths string[] - Server-side file paths to import (JSON mode)
 * @body fromKbPath boolean - Auto-discover from HF_KB_PATH/sources/transcripts/raw (JSON mode)
 * @body domainSlug string - Domain slug for created callers (default: "mabel")
 * @body duplicateHandling string - "skip" | "overwrite" | "create_new" (default: "skip")
 * @body preview boolean - If true, only detect conflicts without importing
 * @body conflictResolutions object - Map of conflictKey to "merge" | "create_new" | "skip"
 * @response 200 { ok: true, created: number, merged: number, updated: number, skipped: number, callers: [...], filesProcessed: number, callsImported: number, errors: [...] }
 * @response 400 { ok: false, error: "No files uploaded" | "No files specified..." }
 * @response 500 { ok: false, error: "..." }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const contentType = request.headers.get("content-type") || "";

    let filesToProcess: Array<{ content: string; filename: string }> = [];
    let domainSlug: string | null = null; // No default domain - callers can exist without one
    let duplicateHandling: "skip" | "overwrite" | "create_new" = "skip";
    let sourceDir: string | null = null;
    let savedToRaw: string[] = [];
    let previewMode = false;
    let conflictResolutions: Record<string, "merge" | "create_new" | "skip"> = {};

    // Handle FormData (browser upload)
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const files = formData.getAll("files") as File[];
      duplicateHandling = (formData.get("duplicateHandling") as string || "skip") as any;
      domainSlug = formData.get("domainSlug") as string || "mabel";
      const saveToRaw = formData.get("saveToRaw") === "true";
      previewMode = formData.get("preview") === "true";
      const resolutionsJson = formData.get("conflictResolutions") as string;
      if (resolutionsJson) {
        try {
          conflictResolutions = JSON.parse(resolutionsJson);
        } catch {}
      }

      if (!files || files.length === 0) {
        return NextResponse.json(
          { ok: false, error: "No files uploaded" },
          { status: 400 }
        );
      }

      // Optionally save files to raw directory for future imports (only on actual import, not preview)
      if (saveToRaw && !previewMode) {
        const rawDir = getTranscriptsRawDir();
        try {
          await fs.mkdir(rawDir, { recursive: true });
          for (const file of files) {
            const content = await file.text();
            const filePath = path.join(rawDir, file.name);
            await fs.writeFile(filePath, content, "utf-8");
            savedToRaw.push(file.name);
          }
        } catch (e: any) {
          console.error("Failed to save files to raw:", e);
          // Continue with import even if save fails
        }
      }

      for (const file of files) {
        const content = await file.text();
        filesToProcess.push({ content, filename: file.name });
      }
    }
    // Handle JSON body (server-side paths or auto-discovery)
    else {
      const body = await request.json();
      const {
        filePaths,
        fromKbPath = false,
        domainSlug: ds = "mabel",
        duplicateHandling: dh = "skip",
        preview = false,
        conflictResolutions: cr = {},
      } = body;
      domainSlug = ds;
      duplicateHandling = dh;
      previewMode = preview;
      conflictResolutions = cr;

      // Mode: Auto-discover from KB path
      if (fromKbPath) {
        sourceDir = getTranscriptsRawDir();
        const discoveredPaths = await scanTranscriptsDir(sourceDir);

        if (discoveredPaths.length === 0) {
          return NextResponse.json({
            ok: true,
            message: `No transcript files found in ${sourceDir}`,
            sourceDir,
            filesProcessed: 0,
            callsImported: 0,
            callersCreated: 0,
          });
        }

        for (const filePath of discoveredPaths) {
          const content = await fs.readFile(filePath, "utf-8");
          const filename = path.basename(filePath);
          filesToProcess.push({ content, filename });
        }
      }
      // Mode: Specific file paths
      else if (filePaths && Array.isArray(filePaths) && filePaths.length > 0) {
        for (const filePath of filePaths) {
          const content = await fs.readFile(filePath, "utf-8");
          const filename = filePath.split("/").pop() || filePath;
          filesToProcess.push({ content, filename });
        }
      }
      // No files specified
      else {
        return NextResponse.json(
          { ok: false, error: "No files specified. Use { filePaths: [...] } or { fromKbPath: true }" },
          { status: 400 }
        );
      }
    }

    // Parse files into caller groups
    const { groups, errors: parseErrors } = parseFilesToCallerGroups(filesToProcess);

    // PREVIEW MODE: Detect conflicts and return them
    if (previewMode) {
      const conflicts = await detectConflicts(groups);
      return NextResponse.json({
        ok: true,
        preview: true,
        conflicts,
        summary: {
          filesCount: filesToProcess.length,
          callersCount: groups.length,
          callsCount: groups.reduce((sum, g) => sum + g.calls.length, 0),
          conflictsCount: conflicts.length,
        },
        parseErrors,
      });
    }

    // Get domain for callers (optional - callers can exist without a domain)
    const domain = domainSlug
      ? await prisma.domain.findUnique({ where: { slug: domainSlug } })
      : null;

    const results = {
      filesProcessed: filesToProcess.length,
      callsImported: 0,
      callersCreated: 0,
      callersMerged: 0,
      skipped: 0,
      updated: 0,
      errors: [...parseErrors] as string[],
    };

    // Track created/updated callers for response
    const importedCallers: Array<{ id: string; name: string | null; email: string | null; isNew: boolean; merged?: boolean }> = [];

    // Process each caller group (using pre-parsed groups)
    for (const group of groups) {
      const { callerKey, phone, callerTag, callerName, calls: callerCalls } = group;

      // Check if this caller is excluded from import (optional - table may not exist)
      let isExcluded = false;
      try {
        const excludeConditions: any[] = [];
        if (phone) excludeConditions.push({ phone });
        if (callerTag) excludeConditions.push({ externalId: `import-tag:${callerTag}` });

        if (excludeConditions.length > 0 && (prisma as any).excludedCaller) {
          const excluded = await (prisma as any).excludedCaller.findFirst({
            where: { OR: excludeConditions },
          });
          isExcluded = !!excluded;
        }
      } catch {
        // ExcludedCaller table may not exist - skip exclusion check
      }

      if (isExcluded) {
        results.skipped += callerCalls.length;
        results.errors.push(`Skipped ${callerCalls.length} calls from excluded caller: ${phone || callerTag}`);
        continue;
      }

      // Find existing caller by phone or external ID
      const callerConditions: any[] = [];
      if (phone) callerConditions.push({ phone });
      if (callerTag) callerConditions.push({ externalId: `import-tag:${callerTag}` });

      let existingCaller = callerConditions.length > 0
        ? await prisma.caller.findFirst({ where: { OR: callerConditions } })
        : null;

      // Check conflict resolution if there's an existing caller with different name
      let caller: typeof existingCaller = null;
      let isNewCaller = false;
      let isMerged = false;

      if (existingCaller) {
        // Check if user provided a resolution for this conflict
        const resolution = conflictResolutions[callerKey];

        if (resolution === "skip") {
          results.skipped += callerCalls.length;
          continue;
        } else if (resolution === "create_new") {
          // Create as new caller (with modified phone to avoid conflict)
          isNewCaller = true;
          let externalId = `import-new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          caller = await prisma.caller.create({
            data: {
              name: callerName,
              phone: null, // Don't duplicate the phone
              domainId: domain?.id,
              externalId,
            },
          });
          results.callersCreated++;
        } else {
          // Default or "merge": use existing caller
          caller = existingCaller;
          isMerged = true;
          results.callersMerged++;

          // Update name if incoming name is better
          const currentNameIsFallback = caller.name?.startsWith('Caller ') ||
                                        caller.name?.startsWith('WNF ') ||
                                        !caller.name;
          const newNameIsReal = callerName &&
                                !callerName.startsWith('Caller ') &&
                                !looksLikeTag(callerName);

          if (currentNameIsFallback && newNameIsReal) {
            caller = await prisma.caller.update({
              where: { id: caller.id },
              data: { name: callerName },
            });
          }
        }
      } else {
        // No existing caller - create new
        isNewCaller = true;
        let externalId: string;
        if (phone) {
          externalId = `import-phone:${phone}`;
        } else if (callerTag) {
          externalId = `import-tag:${callerTag}`;
        } else {
          externalId = `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        }

        caller = await prisma.caller.create({
          data: {
            name: callerName,
            phone: phone || null,
            domainId: domain?.id,
            externalId,
          },
        });
        results.callersCreated++;
      }

      // Track for response
      if (caller && !importedCallers.find(c => c.id === caller!.id)) {
        importedCallers.push({
          id: caller.id,
          name: caller.name,
          email: caller.email,
          isNew: isNewCaller,
          merged: isMerged,
        });
      }

      // Get current call sequence for this caller
      let callSequence = 1;
      let previousCallId: string | null = null;

      const existingCalls = await prisma.call.findMany({
        where: { callerId: caller!.id },
        orderBy: { callSequence: "desc" },
        take: 1,
      });

      if (existingCalls.length > 0 && existingCalls[0].callSequence) {
        callSequence = existingCalls[0].callSequence + 1;
        previousCallId = existingCalls[0].id;
      }

      // Create each call
      for (const vapiCall of callerCalls) {
        // Check if this call already exists (by externalId)
        const existingCall = await prisma.call.findFirst({
          where: { externalId: vapiCall.id },
        });

        if (existingCall) {
          if (duplicateHandling === "skip") {
            previousCallId = existingCall.id;
            if (existingCall.callSequence) callSequence = existingCall.callSequence + 1;
            results.skipped++;
            continue;
          } else if (duplicateHandling === "overwrite") {
            await prisma.call.update({
              where: { id: existingCall.id },
              data: { transcript: vapiCall.transcript },
            });
            results.updated++;
            previousCallId = existingCall.id;
            if (existingCall.callSequence) callSequence = existingCall.callSequence + 1;
            continue;
          }
          // create_new - fall through
        }

        // Find the active prompt that was used for this call
        // (the most recent active prompt composed before the call started)
        const callStartTime = new Date(vapiCall.startedAt || vapiCall.createdAt);
        const activePrompt = await prisma.composedPrompt.findFirst({
          where: {
            callerId: caller!.id,
            status: "active",
            composedAt: { lt: callStartTime },
          },
          orderBy: { composedAt: "desc" },
          select: { id: true },
        });

        // Stamp playbookId from caller's default enrollment so the import
        // is attributed to a course (otherwise UI filters hide it). null is
        // tolerated here — imports may legitimately predate enrollment.
        const importedPlaybookId = await resolvePlaybookId(caller!.id);

        const createdCall = await prisma.call.create({
          data: {
            source: "import",
            externalId: duplicateHandling === "create_new" && existingCall
              ? `${vapiCall.id}-${Date.now()}`
              : vapiCall.id,
            callerId: caller!.id,
            transcript: vapiCall.transcript,
            callSequence,
            previousCallId,
            createdAt: callStartTime,
            usedPromptId: activePrompt?.id || null,
            ...(importedPlaybookId ? { playbookId: importedPlaybookId } : {}),
          },
        });

        results.callsImported++;
        previousCallId = createdCall.id;
        callSequence++;
      }
    }

    return NextResponse.json({
      ok: true,
      created: results.callersCreated,
      merged: results.callersMerged,
      updated: results.updated,
      skipped: results.skipped,
      callers: importedCallers,
      filesProcessed: results.filesProcessed,
      callsImported: results.callsImported,
      errors: results.errors,
      ...(sourceDir && { sourceDir }),
      ...(savedToRaw.length > 0 && { savedToRaw }),
    });
  } catch (error: any) {
    console.error("POST /api/transcripts/import error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to import transcripts" },
      { status: 500 }
    );
  }
}
