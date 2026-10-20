import { readFile } from 'node:fs/promises';
import { validateImage, computeContentHash } from './image-processor.js';
import type { StorageAdapter, ImageValidationResult } from './types.js';

export async function withDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Image retrieval timed out; retry the conversion')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

export interface SourceImage extends ImageValidationResult { buffer: Buffer; sha256: string }
export async function loadSourceImage(
  storage: StorageAdapter,
  asset: { storagePath?: string; sha256?: string; width?: number | null; height?: number | null } | null,
  timeoutMs: number,
): Promise<SourceImage> {
  if (!asset?.storagePath || !asset.sha256) throw new Error('Source screenshot is missing; upload the image again');
  let buffer: Buffer;
  try { buffer = await withDeadline(storage.download(asset.storagePath), timeoutMs); }
  catch { throw new Error('Source screenshot could not be retrieved (missing, expired or timed out); upload it again or check storage access'); }
  const metadata = await validateImage(buffer);
  const sha256 = computeContentHash(buffer);
  if (sha256 !== asset.sha256) throw new Error('Source screenshot integrity mismatch; upload the image again');
  if ((asset.width && asset.width !== metadata.width) || (asset.height && asset.height !== metadata.height)) {
    throw new Error('Source screenshot dimensions differ from the uploaded image');
  }
  return { ...metadata, buffer, sha256 };
}

/** Resolve once before calling a provider. Never include signed URLs in errors. */
export async function resolveInlineImage(input: string, timeoutMs: number): Promise<{ mimeType: string; data: string }> {
  let buffer: Buffer;
  const data = input.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (data) {
    const encoded = data[2].replace(/\s/g, '');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('Invalid image base64 encoding');
    buffer = Buffer.from(encoded, 'base64');
  } else if (/^https?:\/\//i.test(input)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      buffer = await withDeadline((async () => {
        const response = await fetch(input, { signal: controller.signal });
        if (!response.ok) throw new Error(`Image retrieval failed with HTTP ${response.status}; refresh the source URL`);
        if (Number(response.headers.get('content-length')) > 20_000_000) throw new Error('Vision image exceeds 20 MB');
        return Buffer.from(await response.arrayBuffer());
      })(), timeoutMs);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Image retrieval failed with HTTP')) throw error;
      throw new Error('Image retrieval failed or timed out; check source image access');
    } finally { clearTimeout(timer); }
  } else if (/^(?:\.\.?[\\/]|[\\/]|[a-z]:[\\/]|storage[\\/])/i.test(input)) {
    try { buffer = await withDeadline(readFile(input), timeoutMs); }
    catch { throw new Error('Local image could not be read; check the source file'); }
  } else { throw new Error('Unsupported image input; supply an image data URI, HTTP URL or file path'); }
  if (buffer.length > 20_000_000) throw new Error('Vision image exceeds 20 MB; use smaller analysis tiles');
  const metadata = await validateImage(buffer);
  if (data && data[1].toLowerCase() !== metadata.mimeType) throw new Error('Image data URI MIME type does not match its content');
  return { mimeType: metadata.mimeType, data: buffer.toString('base64') };
}
