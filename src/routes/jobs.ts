/**
 * API Routes — Jobs & Conversion
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { Prisma } from '@prisma/client';
import { getStorage } from '../modules/storage/factory.js';
import { withDeadline } from '../modules/storage/image-input.js';
import { env } from '../config/index.js';

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

jobsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const userId = (req as any).user.userId;

    const job = await prisma.conversionJob.findUnique({
      where: { id },
      include: {
        project: true,
        stages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!job || job.project.userId !== userId) {
      throw new NotFoundError('Conversion job not found');
    }

    res.json({ success: true, data: job });
  } catch (err) {
    next(err);
  }
});

jobsRouter.get('/:id/dir', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const userId = (req as any).user.userId;

    const job = await prisma.conversionJob.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!job || job.project.userId !== userId) {
      throw new NotFoundError('Conversion job not found');
    }

    if (!job.dirArtifact) {
      return res.json({ success: true, data: null, ready: false, message: 'DIR JSON not ready for this job' });
    }

    res.json({ success: true, data: job.dirArtifact, ready: true });
  } catch (err) {
    next(err);
  }
});

jobsRouter.get('/:id/elementor', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const userId = (req as any).user.userId;

    const job = await prisma.conversionJob.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!job || job.project.userId !== userId) {
      throw new NotFoundError('Conversion job not found');
    }

    if (!job.elementorArtifact) {
      return res.json({ success: true, data: null, ready: false, message: 'Elementor JSON not ready for this job' });
    }

    res.json({ success: true, data: job.elementorArtifact, ready: true });
  } catch (err) {
    next(err);
  }
});

jobsRouter.post('/:id/retry', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const userId = (req as any).user.userId;

    const job = await prisma.conversionJob.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!job || job.project.userId !== userId) {
      throw new NotFoundError('Conversion job not found');
    }

    if (!['failed', 'cancelled'].includes(job.status)) throw new ValidationError('Only failed or cancelled jobs can be retried');
    const updated = await prisma.conversionJob.update({
      where: { id },
      data: {
        status: 'queued',
        errorMessage: null, errorDetails: Prisma.DbNull, dirArtifact: Prisma.DbNull, elementorArtifact: Prisma.DbNull,
      },
    });

    // Worker owns execution of queued jobs.

    res.json({ success: true, data: updated, message: 'Job retry queued' });
  } catch (err) {
    next(err);
  }
});


// Authenticated source retrieval keeps the screenshot tied to this conversion job.
jobsRouter.get('/:id/source', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await prisma.conversionJob.findUnique({where:{id:req.params.id as string},include:{project:true}});
    if (!job || job.project.userId !== (req as any).user.userId || !job.sourceAssetId) throw new NotFoundError('Conversion source');
    const asset = await prisma.asset.findUnique({where:{id:job.sourceAssetId}});
    if (!asset || asset.projectId !== job.projectId) throw new NotFoundError('Conversion source');
    const buffer = await withDeadline(getStorage().download(asset.storagePath),env.AI_REQUEST_TIMEOUT_MS);
    res.setHeader('Content-Type',asset.mimeType);
    res.setHeader('Cache-Control','private, no-store');
    res.send(buffer);
  } catch(error) { next(error); }
});
