/**
 * API Routes — Jobs & Conversion
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { NotFoundError } from '../lib/errors.js';
import { getConversionOrchestrator } from '../modules/conversion/orchestrator.js';

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
      throw new NotFoundError('DIR JSON not ready for this job');
    }

    res.json({ success: true, data: job.dirArtifact });
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
      throw new NotFoundError('Elementor JSON not ready for this job');
    }

    res.json({ success: true, data: job.elementorArtifact });
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

    await prisma.conversionJob.update({
      where: { id },
      data: {
        status: 'queued',
        errorMessage: null,
      },
    });

    getConversionOrchestrator().processJob(id).catch(() => {});

    res.json({ success: true, message: 'Job retry queued' });
  } catch (err) {
    next(err);
  }
});

