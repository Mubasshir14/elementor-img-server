/**
 * API Routes — Sites & MCP Publishing
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { encrypt, decrypt } from '../modules/security/encryption.js';
import { MCPClient } from '../modules/mcp/client.js';
import { MCPPublisher } from '../modules/mcp/publisher.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';

export const sitesRouter = Router();
sitesRouter.use(requireAuth);

const siteCreateSchema = z.object({
  name: z.string().min(1),
  siteUrl: z.string().url(),
  username: z.string().min(1),
  applicationPassword: z.string().min(1),
});

sitesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const sites = await prisma.siteConnection.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        siteUrl: true,
        wordpressVersion: true,
        elementorVersion: true,
        isMcpAvailable: true,
        lastVerifiedAt: true,
        createdAt: true,
      },
    });

    res.json({ success: true, data: sites });
  } catch (err) {
    next(err);
  }
});

sitesRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const parsed = siteCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid site parameters', parsed.error.format());
    }

    const { name, siteUrl, username, applicationPassword } = parsed.data;
    const encryptedCredentials = encrypt(JSON.stringify({ username, applicationPassword }));

    const site = await prisma.siteConnection.create({
      data: {
        userId,
        name,
        siteUrl,
        encryptedCredentials,
      },
      select: {
        id: true,
        name: true,
        siteUrl: true,
        createdAt: true,
      },
    });

    res.status(201).json({ success: true, data: site });
  } catch (err) {
    next(err);
  }
});

sitesRouter.post('/:id/test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const id = req.params.id as string;

    const site = await prisma.siteConnection.findFirst({ where: { id, userId } });
    if (!site) throw new NotFoundError('Site not found');

    const creds = JSON.parse(decrypt(site.encryptedCredentials));
    const client = new MCPClient({
      siteUrl: site.siteUrl,
      credentials: creds,
    });

    const testRes = await client.testConnection();

    if (testRes.ok) {
      await prisma.siteConnection.update({
        where: { id },
        data: {
          lastVerifiedAt: new Date(),
          isMcpAvailable: true,
          discoveredTools: testRes.capabilities.availableTools as any,
          wordpressVersion: testRes.capabilities.wordpressVersion,
          elementorVersion: testRes.capabilities.elementorVersion,
        },
      });
    }

    res.json({ success: true, data: testRes });
  } catch (err) {
    next(err);
  }
});

export const publishRouter = Router();
publishRouter.use(requireAuth);

const publishSchema = z.object({
  siteConfigId: z.string(),
  resourceType: z.enum(['page', 'template']).default('page'),
  title: z.string().min(1),
  publishMode: z.enum(['draft', 'publish']).default('draft'),
  confirmPublish: z.literal(true, {
    errorMap: () => ({ message: 'Explicit confirmation required to publish' }),
  }),
});

publishRouter.post('/:jobId/publish', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const jobId = req.params.jobId as string;

    const parsed = publishSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid publish request', parsed.error.format());
    }

    const job = await prisma.conversionJob.findUnique({
      where: { id: jobId },
      include: { project: true },
    });
    if (!job || job.project.userId !== userId) {
      throw new NotFoundError('Conversion job not found');
    }

    const site = await prisma.siteConnection.findFirst({
      where: { id: parsed.data.siteConfigId, userId },
    });
    if (!site) throw new NotFoundError('Connected site not found');

    const elementorDoc = job.elementorArtifact;
    if (!elementorDoc) {
      throw new ValidationError('Elementor document is not ready to publish');
    }

    const creds = JSON.parse(decrypt(site.encryptedCredentials));
    const publisher = new MCPPublisher({
      siteUrl: site.siteUrl,
      credentials: creds,
    });

    const idempotencyKey = `pub_${jobId}_${Date.now()}`;
    const result = await publisher.publish({
      elementorJson: elementorDoc,
      title: parsed.data.title,
      resourceType: parsed.data.resourceType,
      publishMode: parsed.data.publishMode,
      siteConfigId: site.id,
      idempotencyKey,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

