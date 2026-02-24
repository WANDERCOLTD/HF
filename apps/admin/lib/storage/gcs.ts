/**
 * Google Cloud Storage Adapter
 *
 * Production storage backend using GCS.
 * Requires STORAGE_GCS_BUCKET env var.
 */

import { Storage } from "@google-cloud/storage";
import { config } from "@/lib/config";
import type { StorageAdapter, UploadOptions, UploadResult } from "./adapter";
import { storageKeyFromHash } from "./utils";


let storageClient: Storage | null = null;

function getClient(): Storage {
  if (!storageClient) {
    storageClient = new Storage();
  }
  return storageClient;
}

function getBucket() {
  return getClient().bucket(config.storage.gcsBucket);
}

export class GCSStorageAdapter implements StorageAdapter {
  async upload(file: Buffer, options: UploadOptions): Promise<UploadResult> {
    const storageKey = storageKeyFromHash(options.contentHash, options.mimeType);
    const bucket = getBucket();
    const blob = bucket.file(storageKey);

    await blob.save(file, {
      metadata: {
        contentType: options.mimeType,
        metadata: {
          originalName: options.fileName,
          contentHash: options.contentHash,
        },
      },
      resumable: false,
    });

    return { storageKey };
  }

  async getSignedUrl(storageKey: string, expirySeconds = config.storage.signedUrlExpirySec, fileName?: string): Promise<string> {
    const bucket = getBucket();
    const blob = bucket.file(storageKey);

    const [url] = await blob.getSignedUrl({
      action: "read",
      expires: Date.now() + expirySeconds * 1000,
      ...(fileName && { responseDisposition: `attachment; filename="${fileName}"` }),
    });

    return url;
  }

  async delete(storageKey: string): Promise<void> {
    const bucket = getBucket();
    await bucket.file(storageKey).delete({ ignoreNotFound: true });
  }

  async download(storageKey: string): Promise<Buffer> {
    const bucket = getBucket();
    const [contents] = await bucket.file(storageKey).download();
    return Buffer.from(contents);
  }

  async exists(storageKey: string): Promise<boolean> {
    const bucket = getBucket();
    const [exists] = await bucket.file(storageKey).exists();
    return exists;
  }
}
