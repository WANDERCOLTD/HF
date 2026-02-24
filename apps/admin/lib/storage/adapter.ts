/**
 * Storage Adapter Interface
 *
 * Pluggable backend for file storage (images, PDFs, audio).
 * Implementations: GCS (production), Local (dev/test).
 */

export interface UploadOptions {
  fileName: string;
  mimeType: string;
  contentHash: string;
}

export interface UploadResult {
  storageKey: string;
}

export interface StorageAdapter {
  /** Upload a file buffer and return the storage key */
  upload(file: Buffer, options: UploadOptions): Promise<UploadResult>;

  /** Download a file by storage key */
  download(storageKey: string): Promise<Buffer>;

  /** Generate a time-limited signed URL for reading. Pass fileName to set Content-Disposition on the response. */
  getSignedUrl(storageKey: string, expirySeconds?: number, fileName?: string): Promise<string>;

  /** Delete a file by storage key */
  delete(storageKey: string): Promise<void>;

  /** Check if a file exists */
  exists(storageKey: string): Promise<boolean>;
}
