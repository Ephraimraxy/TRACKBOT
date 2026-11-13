import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { MAX_UPLOAD_SIZE_MB } from "@/lib/constants/settings";

/**
 * Image storage on Cloudflare R2 (S3-compatible).
 *
 * - Files are checked by their actual bytes (not the browser-supplied type or name).
 * - Object keys are random (`folder/uuid.ext`); the original file name is never used.
 * - Only keys this module could have created may be deleted.
 * - Credentials come from the server environment only (see .env.example).
 */

export type StorageErrorCode = "NOT_CONFIGURED" | "INVALID_FILE" | "TOO_LARGE" | "UPLOAD_FAILED";

export class StorageError extends Error {
  constructor(
    public code: StorageErrorCode,
    message: string
  ) {
    super(message);
    this.name = "StorageError";
  }
}

const MAX_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;
const FOLDER = /^[a-z0-9-]{1,40}$/;
const OWN_KEY = /^[a-z0-9-]{1,40}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

export type ImageType = { ext: "jpg" | "png" | "webp"; mime: string };

/** Identify JPEG, PNG or WebP from the first bytes. Anything else returns null. */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) {
    return { ext: "png", mime: "image/png" };
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

export interface StorageDeps {
  /** Minimal S3 client surface (a fake can be injected in tests). */
  client: Pick<S3Client, "send">;
  bucket: string;
}

export function createStorage({ client, bucket }: StorageDeps) {
  return {
    /** Validate and store one image; returns the object key to save in the database. */
    async uploadImage(file: File, folder: string): Promise<{ key: string }> {
      if (!FOLDER.test(folder)) throw new StorageError("INVALID_FILE", "Invalid folder name.");
      if (file.size > MAX_BYTES) {
        throw new StorageError("TOO_LARGE", `The image must be at most ${MAX_UPLOAD_SIZE_MB} MB.`);
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_BYTES) {
        throw new StorageError("TOO_LARGE", `The image must be at most ${MAX_UPLOAD_SIZE_MB} MB.`);
      }
      const type = detectImageType(bytes);
      if (!type) throw new StorageError("INVALID_FILE", "Only JPEG, PNG or WebP images are accepted.");

      const key = `${folder}/${randomUUID()}.${type.ext}`;
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: bytes,
            ContentType: type.mime,
            CacheControl: "public, max-age=31536000, immutable",
          })
        );
      } catch (error) {
        console.error("[storage] upload failed:", (error as Error).name);
        throw new StorageError("UPLOAD_FAILED", "The image could not be stored.");
      }
      return { key };
    },

    /** Delete an image this module created. Never throws; unknown or foreign keys are ignored. */
    async deleteImage(key: string): Promise<void> {
      if (!OWN_KEY.test(key)) return;
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        console.error("[storage] delete failed:", (error as Error).name);
      }
    },
  };
}

type Env = Record<string, string | undefined>;

export function storageConfig(env: Env = process.env) {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
  const R2_BUCKET = env.R2_BUCKET ?? env.R2_BUCKET_NAME; // R2_BUCKET_NAME is accepted too
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  return {
    bucket: R2_BUCKET,
    client: new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    }),
  };
}

let cached: ReturnType<typeof createStorage> | null | undefined;

/** The storage configured from the environment, or null when R2 is not set up. */
export function getStorage() {
  if (cached === undefined) {
    const cfg = storageConfig();
    cached = cfg ? createStorage(cfg) : null;
  }
  return cached;
}

/** Same as getStorage() but fails with a clear error instead of returning null. */
export function requireStorage() {
  const storage = getStorage();
  if (!storage) {
    throw new StorageError("NOT_CONFIGURED", "Image storage is not configured on the server.");
  }
  return storage;
}

/** Fire-and-forget deletion that is a no-op when storage is not configured. */
export async function deleteStoredImage(key: string): Promise<void> {
  await getStorage()?.deleteImage(key);
}
