import multer from 'multer';
import path from 'path';
import { Request, Response, NextFunction } from 'express';
import { validateImage, computeContentHash } from '../modules/storage/image-processor.js';
import { env } from '../config/index.js';
import { ValidationError } from '../lib/errors.js';

const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

// Use memory storage for intake, in-memory validation, and magic byte checking
const storage = multer.memoryStorage();

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: env.UPLOAD_MAX_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(
        new ValidationError(
          `Invalid file extension '${ext}'. Only .png, .jpg, .jpeg, and .webp are supported.`
        )
      );
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype.toLowerCase())) {
      return cb(
        new ValidationError(
          `Invalid MIME type '${file.mimetype}'. Only image/png, image/jpeg, and image/webp are supported.`
        )
      );
    }

    cb(null, true);
  },
});

export interface ValidatedImageFile {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
}

/**
 * Validates uploaded file magic bytes, checks for decompression bombs,
 * and extracts validated image dimensions using sharp and file-type.
 */
export async function validateImageBuffer(
  file: Express.Multer.File
): Promise<ValidatedImageFile> {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new ValidationError('No file content received');
  }

  const metadata = await validateImage(file.buffer);
  return {
    buffer: file.buffer, originalName: file.originalname,
    mimeType: metadata.mimeType, sizeBytes: file.buffer.length,
    width: metadata.width, height: metadata.height,
    sha256: computeContentHash(file.buffer),
  };
}

/**
 * Express middleware to validate the uploaded image in memory.
 * Attaches `req.validatedImage` to Request.
 */
declare global {
  namespace Express {
    interface Request {
      validatedImage?: ValidatedImageFile;
    }
  }
}

export function validateUploadedImage(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.file) {
    return next(new ValidationError('No image file uploaded'));
  }

  validateImageBuffer(req.file)
    .then((validated) => {
      req.validatedImage = validated;
      next();
    })
    .catch(next);
}
