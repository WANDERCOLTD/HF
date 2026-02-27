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
  | "extracting"
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
    // Error
    error?: string;
  };
}

export type SendIngestEvent = (event: IngestEvent) => void;
