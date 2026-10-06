export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ALLOWED: Record<string, { mime: string; magic?: number[] }> = {
  pdf: { mime: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: [0x50, 0x4b, 0x03, 0x04] }, // zip
  doc: { mime: "application/msword", magic: [0xd0, 0xcf, 0x11, 0xe0] },
  txt: { mime: "text/plain" },
  png: { mime: "image/png", magic: [0x89, 0x50, 0x4e, 0x47] },
  jpg: { mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  jpeg: { mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
};

export type UploadCheck = { ok: true; extension: string; mimeType: string } | { ok: false; error: string };

/**
 * Validate an upload by size, extension and file signature. The browser's
 * declared content type is not trusted.
 */
export function validateUpload(fileName: string, body: Buffer): UploadCheck {
  if (body.length === 0) return { ok: false, error: "The file is empty" };
  if (body.length > MAX_UPLOAD_BYTES) return { ok: false, error: "Files must be 10 MB or smaller" };
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  const rule = ALLOWED[extension];
  if (!rule) return { ok: false, error: "Upload a PDF, Word document, text file or image" };
  if (rule.magic && !rule.magic.every((byte, i) => body[i] === byte)) {
    return { ok: false, error: `This file is not a valid .${extension} file` };
  }
  if (extension === "txt" && body.subarray(0, 8000).includes(0)) return { ok: false, error: "This file is not a text file" };
  return { ok: true, extension, mimeType: rule.mime };
}

/** Strip path segments and control characters from a user-supplied file name. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").trim();
  return cleaned.slice(0, 180) || "file";
}
