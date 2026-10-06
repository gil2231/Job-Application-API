import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** Filesystem driver for local development. Keys are confined to the root directory. */
export class LocalStorageDriver implements StorageDriver {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private pathFor(key: string): string {
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root + sep)) throw new Error("Invalid storage key");
    return full;
  }
  // Content type is not needed on disk; it is recorded on the Document row.
  async put(key: string, body: Buffer, _contentType?: string): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, { mode: 0o600 });
  }
  get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }
  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

/** Any S3-compatible service (AWS S3, MinIO, R2...). Objects are written with server-side encryption. */
export class S3StorageDriver implements StorageDriver {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: "AES256" }),
    );
  }
  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error("Empty object");
    return Buffer.from(await res.Body.transformToByteArray());
  }
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let cached: StorageDriver | null = null;

export function getStorage(env: NodeJS.ProcessEnv = process.env): StorageDriver {
  if (cached) return cached;
  if ((env.STORAGE_DRIVER ?? "local") === "s3") {
    if (!env.S3_BUCKET) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
    const client = new S3Client({
      region: env.S3_REGION ?? "us-east-1",
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
    cached = new S3StorageDriver(client, env.S3_BUCKET);
  } else {
    cached = new LocalStorageDriver(env.STORAGE_LOCAL_DIR ?? ".storage");
  }
  return cached;
}

export function sha256Hex(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

/** Storage keys never contain user-supplied names, only ids. */
export function buildStorageKey(userId: string, kind: string, extension: string): string {
  const safeExt = extension.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  return `users/${userId}/${kind.toLowerCase()}/${randomUUID()}${safeExt ? "." + safeExt : ""}`;
}
