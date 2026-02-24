/**
 * Local Filesystem Storage Adapter
 *
 * Development/test fallback. Stores files on local disk.
 * Serves via the /api/media/[id] route (no signed URLs needed).
 */

import { mkdir, writeFile, unlink, access } from "fs/promises";
import { join, dirname } from "path";
import { config } from "@/lib/config";
import type { StorageAdapter, UploadOptions, UploadResult } from "./adapter";
import { storageKeyFromHash } from "./utils";

export class LocalStorageAdapter implements StorageAdapter {
  private get basePath(): string {
    return config.storage.localPath;
  }

  private fullPath(storageKey: string): string {
    return join(this.basePath, storageKey);
  }

  async upload(file: Buffer, options: UploadOptions): Promise<UploadResult> {
    const storageKey = storageKeyFromHash(options.contentHash, options.mimeType);
    const filePath = this.fullPath(storageKey);

    // Ensure directory exists
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file);

    return { storageKey };
  }

  async getSignedUrl(storageKey: string, _expirySeconds?: number, _fileName?: string): Promise<string> {
    // Local adapter doesn't use signed URLs — the API route handles auth
    // Return a relative URL that the /api/media/[id] route will serve
    return `/api/media/local/${encodeURIComponent(storageKey)}`;
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await unlink(this.fullPath(storageKey));
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await access(this.fullPath(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  async download(storageKey: string): Promise<Buffer> {
    const { readFile } = await import("fs/promises");
    return readFile(this.fullPath(storageKey));
  }
}
