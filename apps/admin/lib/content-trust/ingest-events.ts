/**
 * SSE Event Types for Course-Pack Ingestion
 *
 * Shared between server route (course-pack/ingest) and client (PackUploadStep).
 * Follows the same SSE pattern as institutions/launch and domains/quick-launch.
 */

export type IngestPhase =
  | "init"
  | "creating-subject"
  | "subject-created"
  | "uploading"
  | "source-created"
  | "source-skipped"
  | "extracting"
  | "chunk-retry"
  | "chunk-complete"
  | "images-extracting"
  | "images-complete"
  | "file-complete"
  | "file-error"
  | "post-processing"
  | "complete"
  | "error";

export interface IngestEvent {
  phase: IngestPhase;
  message: string;
  data?: {
    // Subject events
    subjectName?: string;
    subjectId?: string;
    // File events
    fileName?: string;
    sourceId?: string;
    fileIndex?: number;
    totalFiles?: number;
    // Chunk events
    chunkIndex?: number;
    totalChunks?: number;
    // Retry events
    attempt?: number;
    maxAttempts?: number;
    retryDelayMs?: number;
    // Per-chunk extraction counts (for client-side accumulation)
    chunkAssertions?: number;
    chunkQuestions?: number;
    chunkVocabulary?: number;
    // Extraction counts (running totals for current file)
    assertions?: number;
    questions?: number;
    vocabulary?: number;
    images?: number;
    // Complete event
    subjects?: Array<{ id: string; name: string }>;
    sourceCount?: number;
    totalAssertions?: number;
    totalQuestions?: number;
    totalVocabulary?: number;
    totalImages?: number;
    // Per-category breakdown (e.g. { fact: 12, definition: 8, rule: 3 })
    categoryCounts?: Record<string, number>;
    // Dedup
    reused?: boolean;
    // Error
    error?: string;
  };
}

export type SendIngestEvent = (event: IngestEvent) => void;
