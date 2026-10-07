import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

/**
 * Backup file encryption: AES-256-GCM over the whole dump, streamed.
 *
 * Layout: MAGIC (8) | key id (8) | IV (12) | ciphertext | auth tag (16).
 * The key id is the first 8 bytes of sha256(key), so a restore picks the
 * right key after a rotation and fails clearly with the wrong one. The
 * header is bound into the tag as additional data, so it can't be swapped.
 * Decryption writes to a file that is only trusted after the tag verifies.
 */
export const MAGIC = Buffer.from("APLBK001", "ascii");
const HEADER_LENGTH = MAGIC.length + 8 + 12;
const TAG_LENGTH = 16;

export function parseKey(base64: string, name = "BACKUP_ENCRYPTION_KEY"): Buffer {
  const key = Buffer.from(base64.trim(), "base64");
  if (key.length !== 32) throw new Error(`${name} must be 32 bytes, base64-encoded (generate one with: openssl rand -base64 32)`);
  return key;
}

export function keyId(key: Buffer): Buffer {
  return createHash("sha256").update(key).digest().subarray(0, 8);
}

export interface EncryptResult {
  bytes: number;
  sha256: string;
}

export async function encryptFile(source: string, target: string, key: Buffer): Promise<EncryptResult> {
  const iv = randomBytes(12);
  const header = Buffer.concat([MAGIC, keyId(key), iv]);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);
  const hash = createHash("sha256");
  let bytes = 0;
  const counted = (chunk: Buffer) => {
    hash.update(chunk);
    bytes += chunk.length;
    return chunk;
  };
  await pipeline(async function* () {
    yield counted(header);
    for await (const chunk of createReadStream(source)) yield counted(cipher.update(chunk as Buffer));
    yield counted(cipher.final());
    yield counted(cipher.getAuthTag());
  }, createWriteStream(target, { mode: 0o600 }));
  return { bytes, sha256: hash.digest("hex") };
}

/** Decrypts with whichever of `keys` made the file; throws if none did or the file was altered. */
export async function decryptFile(source: string, target: string, keys: Buffer[]): Promise<void> {
  const { size } = await stat(source);
  if (size < HEADER_LENGTH + TAG_LENGTH) throw new Error("Backup file is too small to be a valid backup");
  const handle = await open(source, "r");
  const header = Buffer.alloc(HEADER_LENGTH);
  const tag = Buffer.alloc(TAG_LENGTH);
  try {
    await handle.read(header, 0, HEADER_LENGTH, 0);
    await handle.read(tag, 0, TAG_LENGTH, size - TAG_LENGTH);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not an Applyance backup file");
  const id = header.subarray(MAGIC.length, MAGIC.length + 8);
  const key = keys.find((k) => keyId(k).equals(id));
  if (!key) throw new Error("This backup was encrypted with a key that isn't configured (check BACKUP_ENCRYPTION_KEY and BACKUP_PREVIOUS_ENCRYPTION_KEYS)");
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(MAGIC.length + 8));
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  try {
    await pipeline(createReadStream(source, { start: HEADER_LENGTH, end: size - TAG_LENGTH - 1 }), decipher, createWriteStream(target, { mode: 0o600 }));
  } catch (err) {
    throw new Error(`Backup failed its integrity check and can't be trusted (${(err as Error).message})`, { cause: err });
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}
