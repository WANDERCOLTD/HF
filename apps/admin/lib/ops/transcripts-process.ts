/**
 * Transcript Processing Operation
 *
 * Extracts calls from raw transcript JSON files into the database
 * with hash-based deduplication.
 *
 * Supports varied JSON structures:
 * - Array of calls: [{...}, {...}]
 * - Object with calls array: { calls: [{...}, {...}] }
 * - Single call object: { transcript: "...", customer: {...} }
 *
 * Status outcomes:
 * - COMPLETED: All calls extracted successfully
 * - PARTIAL: Some calls extracted, some failed (failures stored in FailedCall)
 * - FAILED: File-level failure (invalid JSON, unreadable, no calls found)
 *
 * Operation ID: transcripts:process
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { PrismaClient, FileType, ProcessingStatus, FailedCallErrorType } from "@prisma/client";
import { getKbRoot, resolveDataNodePath, clearManifestCache } from "../data-paths";
import { resolvePlaybookId } from "@/lib/enrollment/resolve-playbook";

const prisma = new PrismaClient();

export interface TranscriptProcessOptions {
  autoDetectType?: boolean;
  createCallers?: boolean;
  filepath?: string; // Optional: process specific file only
}

export interface ProcessingResult {
  success: boolean;
  filesProcessed: number;
  callsExtracted: number;
  callsFailed: number;
  callersCreated: number;
  errors: string[];
}

/**
 * Calculate SHA256 hash of file content
 */
function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Detect file type from JSON structure
 */
function detectFileType(json: unknown): FileType {
  if (Array.isArray(json)) {
    return json.length > 1 ? FileType.BATCH_EXPORT : FileType.SINGLE_CALL;
  } else if (json && typeof json === "object" && "calls" in json && Array.isArray((json as any).calls)) {
    return FileType.BATCH_EXPORT;
  }
  return FileType.SINGLE_CALL;
}

/**
 * Extract calls array from various JSON structures
 */
function extractCalls(json: unknown): unknown[] {
  if (Array.isArray(json)) {
    return json;
  } else if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if ("calls" in obj && Array.isArray(obj.calls)) {
      return obj.calls;
    }
    // Single call object - treat the whole thing as one call
    if ("transcript" in obj || "call" in obj || "messages" in obj) {
      return [json];
    }
  }
  return [];
}

/**
 * Extract transcript text from a call object (handles various formats)
 */
function extractTranscript(call: unknown): string | null {
  if (!call || typeof call !== "object") return null;
  const c = call as Record<string, unknown>;

  // Direct transcript field
  if (typeof c.transcript === "string") {
    return c.transcript;
  }

  // Messages array (common VAPI format)
  if (Array.isArray(c.messages)) {
    return c.messages
      .map((m: any) => {
        const role = m.role || "unknown";
        const content = m.content || m.text || "";
        return `${role}: ${content}`;
      })
      .join("\n");
  }

  // Nested in call object
  if (c.call && typeof c.call === "object") {
    return extractTranscript(c.call);
  }

  return null;
}

/**
 * Extract customer/caller info from a call object
 */
function extractCustomerInfo(call: unknown): { email?: string; phone?: string; name?: string; externalId?: string } | null {
  if (!call || typeof call !== "object") return null;
  const c = call as Record<string, unknown>;

  // Direct customer object
  if (c.customer && typeof c.customer === "object") {
    const cust = c.customer as Record<string, unknown>;
    return {
      email: typeof cust.email === "string" ? cust.email : undefined,
      phone: typeof cust.number === "string" || typeof cust.phone === "string"
        ? (cust.number as string) || (cust.phone as string)
        : undefined,
      name: typeof cust.name === "string" ? cust.name : undefined,
      externalId: typeof cust.id === "string" ? cust.id : undefined,
    };
  }

  // CustomerId field
  if (typeof c.customerId === "string") {
    return { externalId: c.customerId };
  }

  // Caller field
  if (c.caller && typeof c.caller === "object") {
    const caller = c.caller as Record<string, unknown>;
    return {
      phone: typeof caller.phone === "string" ? caller.phone : undefined,
      name: typeof caller.name === "string" ? caller.name : undefined,
    };
  }

  return null;
}

/**
 * Extract external ID for the call
 */
function extractCallId(call: unknown): string | null {
  if (!call || typeof call !== "object") return null;
  const c = call as Record<string, unknown>;

  if (typeof c.id === "string") return c.id;
  if (typeof c.callId === "string") return c.callId;
  if (typeof c.call_id === "string") return c.call_id;

  return null;
}

/**
 * Determine error type from error message or context
 */
function classifyError(errorMessage: string, context?: string): FailedCallErrorType {
  const msg = errorMessage.toLowerCase();

  if (msg.includes("no transcript") || msg.includes("transcript not found")) {
    return FailedCallErrorType.NO_TRANSCRIPT;
  }
  if (msg.includes("invalid") || msg.includes("malformed") || msg.includes("parse")) {
    return FailedCallErrorType.INVALID_FORMAT;
  }
  if (msg.includes("duplicate") || msg.includes("already exists") || msg.includes("unique constraint")) {
    return FailedCallErrorType.DUPLICATE;
  }
  if (msg.includes("customer") || msg.includes("caller") || msg.includes("user")) {
    return FailedCallErrorType.NO_CUSTOMER;
  }
  if (msg.includes("database") || msg.includes("prisma") || msg.includes("db")) {
    return FailedCallErrorType.DB_ERROR;
  }

  return FailedCallErrorType.UNKNOWN;
}

/**
 * Create a FailedCall record
 */
async function recordFailedCall(
  processedFileId: string,
  callIndex: number,
  call: unknown,
  errorType: FailedCallErrorType,
  errorMessage: string
): Promise<void> {
  const externalId = extractCallId(call);

  // Truncate raw data if too large (keep first 10KB)
  let rawData = call;
  const rawStr = JSON.stringify(call);
  if (rawStr.length > 10000) {
    rawData = {
      _truncated: true,
      _originalSize: rawStr.length,
      preview: rawStr.slice(0, 5000) + "..."
    };
  }

  await prisma.failedCall.create({
    data: {
      processedFileId,
      callIndex,
      externalId,
      errorType,
      errorMessage,
      rawData: rawData as any,
    }
  });
}

/**
 * Process a single transcript file
 */
async function processFile(
  filePath: string,
  filename: string,
  options: TranscriptProcessOptions
): Promise<{ callsExtracted: number; callsFailed: number; callersCreated: number; error?: string }> {
  console.log(`Processing file: ${filename}`);

  try {
    // Read file content
    const content = await fs.readFile(filePath, "utf8");
    const fileHash = hashContent(content);
    const stats = await fs.stat(filePath);

    // Check if already processed (COMPLETED or PARTIAL)
    const existing = await prisma.processedFile.findUnique({
      where: { fileHash }
    });

    if (existing && (existing.status === ProcessingStatus.COMPLETED || existing.status === ProcessingStatus.PARTIAL)) {
      console.log(`Skipping already processed file: ${filename} (status: ${existing.status})`);
      return { callsExtracted: 0, callsFailed: 0, callersCreated: 0 };
    }

    // Parse JSON
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch (parseErr) {
      throw new Error(`Invalid JSON: ${(parseErr as Error).message}`);
    }

    const fileType = options.autoDetectType !== false ? detectFileType(json) : FileType.BATCH_EXPORT;
    const calls = extractCalls(json);

    if (calls.length === 0) {
      throw new Error("No calls found in file - unrecognized structure");
    }

    console.log(`Found ${calls.length} calls in ${filename}`);

    // Create or update ProcessedFile record
    const processedFile = await prisma.processedFile.upsert({
      where: { fileHash },
      create: {
        filename,
        filepath: filePath,
        fileHash,
        fileType,
        callCount: calls.length,
        callsExtracted: 0,
        callsFailed: 0,
        callersCreated: 0,
        sizeBytes: BigInt(stats.size),
        status: ProcessingStatus.PROCESSING,
        sourcePreserved: true
      },
      update: {
        status: ProcessingStatus.PROCESSING,
        callCount: calls.length,
        errorMessage: null
      }
    });

    // Clear any existing FailedCall records for this file (in case of retry)
    await prisma.failedCall.deleteMany({
      where: { processedFileId: processedFile.id }
    });

    // Process calls
    let callsExtracted = 0;
    let callsFailed = 0;
    let callersCreated = 0;
    const callerMap = new Map<string, string>(); // identifier -> callerId

    // Get default domain for new callers
    const defaultDomain = await prisma.domain.findFirst({
      where: { isDefault: true, isActive: true },
      select: { id: true },
    });

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];

      try {
        // Extract transcript
        const transcript = extractTranscript(call);
        if (!transcript) {
          await recordFailedCall(
            processedFile.id,
            i,
            call,
            FailedCallErrorType.NO_TRANSCRIPT,
            "No transcript field found in call object"
          );
          callsFailed++;
          continue;
        }

        // Extract call ID
        const externalId = extractCallId(call);

        // Check for duplicate call
        if (externalId) {
          const existingCall = await prisma.call.findFirst({
            where: { externalId }
          });
          if (existingCall) {
            // Not really a failure - just skip
            console.log(`Skipping duplicate call: ${externalId}`);
            callsExtracted++; // Count as extracted since it exists
            continue;
          }
        }

        // Extract and create/find caller if enabled
        let callerId: string | undefined;
        if (options.createCallers !== false) {
          const customerInfo = extractCustomerInfo(call);

          if (customerInfo) {
            // Create a unique identifier for the caller
            const callerKey = customerInfo.externalId || customerInfo.email || customerInfo.phone;

            if (callerKey && !callerMap.has(callerKey)) {
              // Check if caller exists
              let caller = await prisma.caller.findFirst({
                where: {
                  OR: [
                    customerInfo.externalId ? { externalId: customerInfo.externalId } : {},
                    customerInfo.email ? { email: customerInfo.email } : {},
                    customerInfo.phone ? { phone: customerInfo.phone } : {},
                  ].filter(c => Object.keys(c).length > 0)
                }
              });

              if (!caller) {
                caller = await prisma.caller.create({
                  data: {
                    email: customerInfo.email || null,
                    phone: customerInfo.phone || null,
                    name: customerInfo.name || null,
                    externalId: customerInfo.externalId || null,
                    domainId: defaultDomain?.id || null,
                  }
                });
                callersCreated++;
                console.log(`Created caller: ${callerKey}${defaultDomain ? ` (domain: default)` : ""}`);
              }

              callerMap.set(callerKey, caller.id);
            }

            callerId = callerKey ? callerMap.get(callerKey) : undefined;
          }
        }

        // Stamp playbookId from caller's default enrollment (skip if no callerId).
        // Tolerates null — VAPI imports can legitimately predate enrollment.
        const importedPlaybookId = callerId ? await resolvePlaybookId(callerId) : null;

        // Create Call record
        await prisma.call.create({
          data: {
            source: "VAPI",
            externalId: externalId || null,
            transcript,
            callerId: callerId || null,
            ...(importedPlaybookId ? { playbookId: importedPlaybookId } : {}),
          }
        });

        callsExtracted++;
        console.log(`Extracted call ${i + 1}/${calls.length}${externalId ? ` (${externalId})` : ""}`);

      } catch (err: any) {
        const errorType = classifyError(err.message);
        await recordFailedCall(
          processedFile.id,
          i,
          call,
          errorType,
          err.message
        );
        callsFailed++;
        console.error(`Error processing call ${i + 1}:`, err.message);
      }
    }

    // Determine final status
    let finalStatus: ProcessingStatus;
    if (callsFailed === 0) {
      finalStatus = ProcessingStatus.COMPLETED;
    } else if (callsExtracted === 0) {
      finalStatus = ProcessingStatus.FAILED;
    } else {
      finalStatus = ProcessingStatus.PARTIAL;
    }

    // Update ProcessedFile with results
    await prisma.processedFile.update({
      where: { id: processedFile.id },
      data: {
        status: finalStatus,
        callsExtracted,
        callsFailed,
        callersCreated,
        processedAt: new Date(),
        errorMessage: callsFailed > 0 ? `${callsFailed} call(s) failed to extract` : null
      }
    });

    console.log(`Processed ${filename}: ${callsExtracted} extracted, ${callsFailed} failed, ${callersCreated} callers created (status: ${finalStatus})`);

    return { callsExtracted, callsFailed, callersCreated };

  } catch (error: any) {
    console.error(`Error processing ${filename}:`, error.message);

    // Try to mark file as failed
    try {
      const content = await fs.readFile(filePath, "utf8");
      const fileHash = hashContent(content);
      const stats = await fs.stat(filePath);

      await prisma.processedFile.upsert({
        where: { fileHash },
        create: {
          filename,
          filepath: filePath,
          fileHash,
          fileType: FileType.SINGLE_CALL,
          callCount: 0,
          callsExtracted: 0,
          callsFailed: 0,
          callersCreated: 0,
          sizeBytes: BigInt(stats.size),
          status: ProcessingStatus.FAILED,
          errorMessage: error.message,
          sourcePreserved: true
        },
        update: {
          status: ProcessingStatus.FAILED,
          errorMessage: error.message
        }
      });
    } catch {
      // Ignore errors when trying to mark as failed
    }

    return { callsExtracted: 0, callsFailed: 0, callersCreated: 0, error: error.message };
  }
}

/**
 * Recursively scan directory for JSON files
 */
async function scanDirRecursive(dir: string): Promise<{ path: string; name: string }[]> {
  const files: { path: string; name: string }[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        // Recurse into subdirectories
        const subFiles = await scanDirRecursive(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        files.push({ path: fullPath, name: entry.name });
      }
    }
  } catch (err) {
    // Directory doesn't exist or isn't readable
    console.log(`Could not read directory: ${dir}`);
  }

  return files;
}

/**
 * Main processing function
 */
export async function processTranscripts(options: TranscriptProcessOptions = {}): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    success: false,
    filesProcessed: 0,
    callsExtracted: 0,
    callsFailed: 0,
    callersCreated: 0,
    errors: []
  };

  try {
    // Clear cache to pick up any env changes at runtime
    clearManifestCache();

    // Use unified data-paths system (reads from agents.json manifest)
    const kbRoot = getKbRoot();
    const transcriptsDir = resolveDataNodePath("data:transcripts") || path.join(kbRoot, "sources/transcripts");

    console.log(`[transcripts-process] HF_KB_PATH env: "${process.env.HF_KB_PATH}"`);
    console.log(`[transcripts-process] KB root: ${kbRoot}`);
    console.log(`[transcripts-process] Scanning: ${transcriptsDir}`);

    // Get list of files to process
    let filesToProcess: { path: string; name: string }[] = [];

    if (options.filepath) {
      // Process specific file
      filesToProcess = [{ path: options.filepath, name: path.basename(options.filepath) }];
    } else {
      // Recursively find all JSON files
      filesToProcess = await scanDirRecursive(transcriptsDir);
    }

    console.log(`Found ${filesToProcess.length} files to process`);

    // Process each file
    for (const file of filesToProcess) {
      const fileResult = await processFile(file.path, file.name, options);

      result.filesProcessed++;
      result.callsExtracted += fileResult.callsExtracted;
      result.callsFailed += fileResult.callsFailed;
      result.callersCreated += fileResult.callersCreated;

      if (fileResult.error) {
        result.errors.push(`${file.name}: ${fileResult.error}`);
      }
    }

    result.success = result.errors.length === 0;
    console.log(`Processing complete: ${result.filesProcessed} files, ${result.callsExtracted} calls extracted, ${result.callsFailed} failed, ${result.callersCreated} callers`);

    return result;

  } catch (error: any) {
    console.error("Fatal error processing transcripts:", error);
    result.errors.push(error.message);
    return result;
  } finally {
    await prisma.$disconnect();
  }
}
