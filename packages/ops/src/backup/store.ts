import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

export interface StoredObject {
  key: string;
  size: number;
  lastModified: Date;
}

/** Where encrypted backups are kept: an S3-compatible bucket, or a folder for local use and tests. */
export interface BackupStore {
  readonly description: string;
  upload(key: string, filePath: string): Promise<void>;
  download(key: string, filePath: string): Promise<void>;
  putText(key: string, text: string): Promise<void>;
  getText(key: string): Promise<string>;
  list(prefix: string): Promise<StoredObject[]>;
  delete(key: string): Promise<void>;
}

export class LocalBackupStore implements BackupStore {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  get description() {
    return `folder ${this.root}`;
  }
  private pathFor(key: string): string {
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root + sep)) throw new Error("Invalid backup key");
    return full;
  }
  async upload(key: string, filePath: string) {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(filePath, target);
  }
  async download(key: string, filePath: string) {
    await copyFile(this.pathFor(key), filePath);
  }
  async putText(key: string, text: string) {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, text, { mode: 0o600 });
  }
  getText(key: string) {
    return readFile(this.pathFor(key), "utf8");
  }
  async list(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else {
          const key = relative(this.root, full).split(sep).join("/");
          if (!key.startsWith(prefix)) continue;
          const s = await stat(full);
          out.push({ key, size: s.size, lastModified: s.mtime });
        }
      }
    };
    await walk(this.root);
    return out;
  }
  async delete(key: string) {
    await rm(this.pathFor(key), { force: true });
  }
}

export class S3BackupStore implements BackupStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}
  get description() {
    return `bucket ${this.bucket}`;
  }
  async upload(key: string, filePath: string) {
    const { size } = await stat(filePath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentLength: size,
        ContentType: "application/octet-stream",
        // The file is already encrypted with our key; this adds the bucket's own encryption on top.
        ServerSideEncryption: "AES256",
      }),
    );
  }
  async download(key: string, filePath: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Backup ${key} is empty`);
    await pipeline(res.Body as Readable, createWriteStream(filePath, { mode: 0o600 }));
  }
  async putText(key: string, text: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: text, ContentType: "application/json", ServerSideEncryption: "AES256" }));
  }
  async getText(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`${key} is empty`);
    return res.Body.transformToString("utf8");
  }
  async list(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of res.Contents ?? []) if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified ?? new Date(0) });
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
