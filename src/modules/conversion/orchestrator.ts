/**
 * Conversion Module — Orchestrator
 * Coordinates image analysis -> DIR generation -> validation & repair -> Elementor compilation -> artifact persistence
 */

import { Prisma, type StageName, type JobStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { getAIRouter } from '../ai/router.js';
import { validateDIR, parseDIRFromAIOutput } from '../dir/schema.js';
import { normalizeDIR, normalizeSection } from '../dir/normalizer.js';
import { convertDIRToElementor } from '../elementor/generator.js';
import { validateElementor } from '../elementor/validator.js';
import { serializeElementorTemplate, loadSkillPack } from '../elementor/serializer.js';
import { getStorage } from '../storage/factory.js';
import { getImageAnalysisPrompt, getDIRRepairPrompt, getSectionRepairPrompt, getElementorSelfHealingGatePrompt } from './prompts.js';
import { cropAsset, computeContentHash } from '../storage/image-processor.js';
import type { DIRDocument } from '../dir/types.js';
import { loadSourceImage, resolveInlineImage, type SourceImage } from '../storage/image-input.js';
import { prepareAnalysisImages, mergeTileDocuments, type AnalysisTile } from './preprocessing.js';
import { auditCorrespondence } from './structural-audit.js';
import { env } from '../../config/index.js';

export interface QualityAuditResult {
  passed: boolean;
  totalPages: number;
  totalSections: number;
  totalDirNodes: number;
  totalContainers: number;
  totalWidgets: number;
  imageCount: number;
  resolvedImageCount: number;
  details: string;
  structuralValidity?: 'passed';
  visualFidelity?: { status: 'not_measured'; reason: string };
  warnings?: string[];
  fidelityAudit?: {
    typographyPreserved: boolean;
    layoutPreserved: boolean;
    noFullScreenshotFallbacks: boolean;
    imageIntegrityVerified: boolean;
  };
}

function enforceFactualMetadata(
  doc: any,
  sourceHash: string,
  sourceAsset: any,
  provider: string,
  model: string,
  promptVersion: string
): void {
  if (!doc || typeof doc !== 'object') return;
  doc.meta = {
    sourceImageHash: sourceHash,
    sourceWidth: sourceAsset.width,
    sourceHeight: sourceAsset.height,
    analysisProvider: provider,
    analysisModel: model,
    analysisTimestamp: doc.meta?.analysisTimestamp || new Date().toISOString(),
    confidenceScore: typeof doc.meta?.confidenceScore === 'number' ? doc.meta.confidenceScore : 0.9,
    schemaVersion: '1.0.0',
    promptVersion: promptVersion,
    notes: Array.isArray(doc.meta?.notes) ? doc.meta.notes : [],
  };
}

export class ConversionOrchestrator {
  private aiRouter = getAIRouter();
  private storage = getStorage();

  public async processJob(jobId: string): Promise<void> {
    logger.info({ jobId }, 'Starting conversion job execution');

    const job = await prisma.conversionJob.findUnique({
      where: { id: jobId },
      include: { project: true },
    });

    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    let activeStage: StageName = 'upload_validation';
    const markStatus = async (status: JobStatus, stage: StageName): Promise<void> => {
      activeStage = stage;
      await this.updateStatus(jobId,status,stage);
    };
    try {
      // Stage 1: VALIDATING_UPLOAD
      await markStatus('validating_upload', 'upload_validation');
      const sourceAsset = job.sourceAssetId
        ? await prisma.asset.findUnique({ where: { id: job.sourceAssetId } })
        : null;

      const source = await loadSourceImage(this.storage, sourceAsset, env.AI_REQUEST_TIMEOUT_MS);

      // Stage 2: ANALYZING_IMAGE -> DIR_READY
      await markStatus('analyzing_image', 'image_analysis');

      // Always execute fresh conversion without reusing prior database cache or artifacts
      const tiles = await prepareAnalysisImages(source);
      const analyses: { document: DIRDocument; tile: AnalysisTile }[] = [];
      for (const tile of tiles) {
        analyses.push({ document: await this.executeDIRStage(job, { ...sourceAsset, width: tile.width, height: tile.height }, tile), tile });
      }
      const dirDoc = mergeTileDocuments(analyses, source);
      const mergedValidation = validateDIR(dirDoc);
      if (!mergedValidation.valid) throw new Error(`Merged DIR is invalid: ${JSON.stringify(mergedValidation.errors)}`);

      await markStatus('dir_ready', 'dir_validation');

      // Resolve and extract sub-assets (e.g. hero graphic artwork, logos) from source image
      await this.resolveAndExtractAssets(job, sourceAsset, dirDoc, source);

      // Stage 3: GENERATING_ELEMENTOR (Stage C)
      await markStatus('generating_elementor', 'elementor_generation');
      const { document: initialDoc, report } = convertDIRToElementor(dirDoc);

      // Stage 4: VALIDATING_ELEMENTOR & SELF-HEALING GATE (Stage D)
      await markStatus('validating_elementor', 'elementor_validation');
      let elementorDoc = initialDoc;
      let validation = validateElementor(elementorDoc);

      // Execute Stage D Self-Healing Gate if review provider is available or validation found issues
      if (this.aiRouter.isProviderAvailable('openrouter') && !validation.valid) {
        try {
          const healingPrompt = getElementorSelfHealingGatePrompt(dirDoc, elementorDoc, validation.errors);
          const healRes = await this.aiRouter.execute({
            role: 'review',
            messages: [
              { role: 'system', content: healingPrompt.systemPrompt },
              { role: 'user', content: healingPrompt.userPrompt },
            ],
            responseFormat: { type: 'json_object' },
            bypassCache: true,
            maxTokens: 16384,
          });

          if (healRes.content && healRes.finishReason !== 'length') {
            const healedJson = JSON.parse(healRes.content);
            const healedValidation = validateElementor(healedJson);
            if (healedValidation.valid) {
              elementorDoc = healedJson;
              validation = healedValidation;
              logger.info({ jobId }, 'Stage D Self-Healing Gate successfully patched and validated Elementor AST');
            }
          }
        } catch (healErr: any) {
          logger.warn({ jobId, err: healErr?.message }, 'Stage D AI self-healing gate encountered error; adhering to compiled AST');
        }
      }

      if (!validation.valid) throw new Error(`Elementor compilation failed validation: ${JSON.stringify(validation.errors)}`);

      // Verify structural completeness; rendered fidelity is not measured here.
      const qualityAudit = this.verifyVisualQuality(dirDoc, elementorDoc, { sourceAssetPath: sourceAsset?.storagePath, nodeElementIds: report.nodeElementIds });
      qualityAudit.warnings = [...(qualityAudit.warnings || []), ...report.warnings, ...validation.warnings.map(warning => warning.message)];
      logger.info({ jobId, qualityAudit }, 'Structural verification completed; visual fidelity not measured');

      if (!validation.valid) {
        logger.warn({ jobId, errors: validation.errors }, 'Elementor validation warnings/errors encountered');
      }

      await prisma.jobStage.upsert({
        where: {
          jobId_stage_attempt: {
            jobId: job.id,
            stage: 'elementor_validation',
            attempt: job.attempts || 1,
          },
        },
        update: {
          status: 'completed',
          outputPayload: {
            valid: validation.valid,
            qualityAudit,
            widgetsUsed: Array.from(report.widgetsUsed),
            elementCount: report.elementCount,
          } as any,
          durationMs: 0,
        },
        create: {
          jobId: job.id,
          stage: 'elementor_validation',
          attempt: job.attempts || 1,
          status: 'completed',
          outputPayload: {
            valid: validation.valid,
            qualityAudit,
            widgetsUsed: Array.from(report.widgetsUsed),
            elementCount: report.elementCount,
          } as any,
          durationMs: 0,
        },
      });

      // Save Elementor JSON artifact
      const serialized = serializeElementorTemplate(elementorDoc);
      const elementorBuffer = Buffer.from(serialized, 'utf-8');
      const storageKey = `projects/${job.projectId}/elementor-${jobId}.json`;
      const uploadRes = await this.storage.upload(storageKey, elementorBuffer, 'application/json');

      await prisma.asset.create({
        data: {
          projectId: job.projectId,
          fileName: `elementor-${jobId}.json`,
          mimeType: 'application/json',
          sizeBytes: BigInt(uploadRes.size),
          storageProvider: env.STORAGE_PROVIDER,
          storagePath: uploadRes.key,
          sha256: uploadRes.contentHash,
          metadata: {
            elementCount: report.elementCount,
            widgetsUsed: report.widgetsUsed,
            qualityAudit: qualityAudit as any,
          },
        },
      });

      // Update job to preview_ready
      await prisma.conversionJob.update({
        where: { id: jobId },
        data: {
          status: 'preview_ready',
          currentStage: 'elementor_validation',
          dirArtifact: dirDoc as any,
          elementorArtifact: elementorDoc as any,
        },
      });

      logger.info({ jobId }, 'Conversion job completed successfully');
    } catch (err: any) {
      logger.error({ jobId, error: err.message }, 'Conversion job failed');
      await prisma.jobStage.upsert({
        where: { jobId_stage_attempt: { jobId, stage: activeStage, attempt: job.attempts || 1 } },
        update: { status: 'failed', errorMessage: err.message },
        create: { jobId, stage: activeStage, attempt: job.attempts || 1, status: 'failed', errorMessage: err.message },
      }).catch(() => {});
      try {
        await prisma.conversionJob.update({
          where: { id: jobId },
          data: {
            status: 'failed',
            dirArtifact: Prisma.DbNull,
            elementorArtifact: Prisma.DbNull,
            errorMessage: err.message,
            errorDetails: { stack: err.stack },
          },
        });
      } catch {
        // Job record might have been deleted concurrently
      }
      throw err;
    }
  }

  private async executeDIRStage(job: any, sourceAsset: any, analysis: AnalysisTile): Promise<DIRDocument> {
    const skillPack = loadSkillPack();
    const prompt = getImageAnalysisPrompt(
      {
        width: sourceAsset?.width || 1440,
        height: sourceAsset?.height || 900,
        mimeType: sourceAsset?.mimeType || 'image/png',
        sha256: sourceAsset.sha256,
        isTiled: analysis.totalTiles > 1, tileIndex: analysis.index, totalTiles: analysis.totalTiles, overlapY: 400,
      },
      skillPack.operativeInstructions
    );

    const userParts: any[] = [
      { type: 'text', text: prompt.userPrompt },
    ];

    userParts.push({ type: 'image_url', image_url: {
      url: `data:${analysis.mimeType};base64,${analysis.buffer.toString('base64')}`,
    } });

    const sourceHash = sourceAsset?.sha256 || 'mock-hash';
    const schemaVer = '1.0.0';
    const skillVer = skillPack.meta.instructionHash || '1.0.0';
    const promptVer = prompt.version;

    const aiRes = await this.aiRouter.execute({
      role: 'vision',
      messages: [
        { role: 'system', content: prompt.systemPrompt },
        { role: 'user', content: userParts },
      ],
      responseFormat: { type: 'json_object' },
      sourceImageHash: sourceHash,
      schemaVersion: schemaVer,
      skillVersion: skillVer,
      promptVersion: promptVer,
      stageName: 'dir_generation',
      maxTokens: 16384,
      bypassCache: true,
    });

    // Check for explicit output truncation
    if (['length', 'MAX_TOKENS'].includes(aiRes.finishReason || '')) {
      logger.warn({ jobId: job.id, provider: aiRes.provider }, 'AI vision response was truncated by output token limit (finishReason: length)');
      const cacheKey = this.aiRouter.computeCacheKey({
        sourceImageHash: sourceHash,
        schemaVersion: schemaVer,
        promptVersion: promptVer,
        provider: aiRes.provider,
        model: aiRes.model,
        stage: 'dir_generation',
      });
      await this.aiRouter.invalidateCacheKey(cacheKey);
      throw new Error('AI vision output was truncated; retry with smaller image tiles');
    }
    if (!aiRes.content?.trim()) throw new Error('AI vision returned empty output');

    const parsed = parseDIRFromAIOutput(aiRes.content);
    if ('error' in parsed) {
      const cacheKey = this.aiRouter.computeCacheKey({
        sourceImageHash: sourceHash,
        schemaVersion: schemaVer,
        promptVersion: promptVer,
        provider: aiRes.provider,
        model: aiRes.model,
        stage: 'dir_generation',
      });
      await this.aiRouter.invalidateCacheKey(cacheKey);

      if (['length', 'MAX_TOKENS'].includes(aiRes.finishReason || '')) {
        throw new Error('AI generation was truncated due to output token limit (finish_reason: length). Could not parse complete DIR JSON.');
      }
      throw new Error(`Failed to parse AI output as DIR JSON: ${parsed.error}`);
    }

    let currentDoc: any = normalizeDIR(parsed.parsed);
    enforceFactualMetadata(currentDoc, sourceHash, sourceAsset, aiRes.provider, aiRes.model, promptVer);
    let validation = validateDIR(currentDoc);

    // If cached response was returned but is invalid, invalidate it
    if (!validation.valid && aiRes.cached) {
      logger.warn({ jobId: job.id }, 'Cached AI response failed schema validation; invalidating cache entry');
      const cacheKey = this.aiRouter.computeCacheKey({
        sourceImageHash: sourceHash,
        schemaVersion: schemaVer,
        promptVersion: promptVer,
        provider: aiRes.provider,
        model: aiRes.model,
        stage: 'dir_generation',
      });
      await this.aiRouter.invalidateCacheKey(cacheKey);
    }

    // Attempt Bounded Repair if invalid
    if (!validation.valid) {
      logger.warn({ errors: validation.errors }, 'DIR validation failed, executing bounded repair');

      // Strategy 1: Section-level targeted repair if errors are isolated to sections
      const sectionErrorMap = new Map<number, typeof validation.errors>();
      let hasRootErrors = false;

      for (const err of validation.errors) {
        const match = err.path.match(/^pages\.\d+\.sections\.(\d+)(?:\.(.*))?$/);
        if (match) {
          const secIdx = parseInt(match[1], 10);
          const subPath = match[2] || '';
          const list = sectionErrorMap.get(secIdx) || [];
          list.push({ ...err, path: subPath });
          sectionErrorMap.set(secIdx, list);
        } else {
          hasRootErrors = true;
        }
      }

      const hasSections = Array.isArray(currentDoc?.pages?.[0]?.sections);
      if (!hasRootErrors && hasSections && sectionErrorMap.size > 0 && sectionErrorMap.size <= 5) {
        logger.info({ sectionCount: sectionErrorMap.size }, 'Repairing isolated invalid sections');
        for (const [secIdx, secErrors] of sectionErrorMap.entries()) {
          const targetSection = currentDoc.pages[0].sections[secIdx];
          if (targetSection) {
            try {
              const secPrompt = getSectionRepairPrompt(targetSection, secErrors);
              const secRes = await this.aiRouter.execute({
                role: 'structure',
                messages: [
                  { role: 'system', content: secPrompt.systemPrompt },
                  { role: 'user', content: secPrompt.userPrompt },
                ],
                responseFormat: { type: 'json_object' },
                bypassCache: true,
                maxTokens: 4096,
              });
              if (secRes.finishReason !== 'length' && secRes.content) {
                const rawSec = JSON.parse(secRes.content);
                currentDoc.pages[0].sections[secIdx] = normalizeSection(rawSec);
              }
            } catch (err: any) {
              logger.warn({ secIdx, error: err?.message }, 'Section-level repair failed; will fall back to document repair');
            }
          }
        }

        // Re-validate after section repairs
        currentDoc = normalizeDIR(currentDoc);
        enforceFactualMetadata(currentDoc, sourceHash, sourceAsset, aiRes.provider, aiRes.model, promptVer);
        validation = validateDIR(currentDoc);
      }

      // Strategy 2: Document-level bounded repair if still invalid (max 2 attempts)
      let attempt = 0;
      const maxAttempts = 2;

      while (!validation.valid && attempt < maxAttempts) {
        attempt++;
        logger.info({ attempt, maxAttempts, errorCount: validation.errors.length }, 'Executing document-level DIR repair');

        const repairPrompt = getDIRRepairPrompt(currentDoc, validation.errors);
        const repairRes = await this.aiRouter.execute({
          role: 'structure',
          messages: [
            { role: 'system', content: repairPrompt.systemPrompt },
            { role: 'user', content: repairPrompt.userPrompt },
          ],
          responseFormat: { type: 'json_object' },
          promptVersion: repairPrompt.version,
          schemaVersion: schemaVer,
          stageName: 'dir_repair',
          bypassCache: true,
          maxTokens: 16384,
        });

        if (repairRes.finishReason === 'length') {
          logger.warn('DIR repair output was truncated by token limit (finish_reason: length)');
          throw new Error('DIR repair output was truncated by output token limit (finish_reason: length). Document cannot be safely repaired as a single monolith.');
        }

        const repairedParsed = parseDIRFromAIOutput(repairRes.content);
        if ('error' in repairedParsed) {
          throw new Error(`Failed to parse repaired DIR JSON: ${repairedParsed.error}`);
        }

        currentDoc = normalizeDIR(repairedParsed.parsed);
        enforceFactualMetadata(currentDoc, sourceHash, sourceAsset, aiRes.provider, aiRes.model, promptVer);
        validation = validateDIR(currentDoc);
      }

      if (!validation.valid) {
        const issues = validation.errors.map((e) => `\n- ${e.path}: ${e.message}`).join('');
        throw new Error(`DIR remained invalid after repair:${issues}`);
      }
    }

    const validDoc = validation.document!;

    // Persist Validated Stage Result
    await prisma.jobStage.upsert({
      where: {
        jobId_stage_attempt: {
          jobId: job.id,
          stage: 'dir_generation',
          attempt: job.attempts || 1,
        },
      },
      update: {
        status: 'completed',
        outputPayload: validDoc as any,
        providerName: aiRes.provider,
        modelName: aiRes.model,
        tokensUsed: aiRes.usage.inputTokens + aiRes.usage.outputTokens,
        durationMs: aiRes.latencyMs,
      },
      create: {
        jobId: job.id,
        stage: 'dir_generation',
        attempt: job.attempts || 1,
        status: 'completed',
        outputPayload: validDoc as any,
        providerName: aiRes.provider,
        modelName: aiRes.model,
        tokensUsed: aiRes.usage.inputTokens + aiRes.usage.outputTokens,
        durationMs: aiRes.latencyMs,
      },
    });

    return validDoc;
  }

  private async resolveAndExtractAssets(
    job: any,
    sourceAsset: any,
    dirDoc: DIRDocument,
    source: SourceImage
  ): Promise<void> {
    const references: { node: any; key: string; assetId: string }[] = [];
    const visit = (value: any): void => {
      if (!value || typeof value !== 'object') return;
      if (value.kind === 'image' && !value.assetId) {
        const assetId = `asset_${value.id}`;
        dirDoc.assets.push({ id: assetId, type: 'image', role: value.alt || 'page-image',
          confidence: value.confidence, sourceRect: value.sourceRect, url: value.url || value.imageUrl });
        value.assetId = assetId;
      }
      if (typeof value.assetId === 'string') references.push({ node: value, key: 'url', assetId: value.assetId });
      if (typeof value.backgroundImageAssetId === 'string') references.push({ node: value, key: 'backgroundImage', assetId: value.backgroundImageAssetId });
      Object.values(value).forEach(visit);
    };
    visit(dirDoc.pages);
    const resolved = new Map<string, { url: string; path: string }>();
    for (const id of new Set(references.map(ref => ref.assetId))) {
      const asset = dirDoc.assets.find(candidate => candidate.id === id);
      if (!asset) throw new Error(`Missing referenced image asset '${id}'`);
      let buffer: Buffer;
      let mimeType: string;
      let path = '';
      if (asset.sourceRect) {
        const rect = asset.sourceRect;
        if (!Object.values(rect).every(Number.isFinite) || rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1 || rect.x + rect.width > source.width + 1 || rect.y + rect.height > source.height + 1) {
          throw new Error(`Image asset '${id}' has invalid sourceRect bounds`);
        }
        buffer = await cropAsset(source.buffer, rect);
        mimeType = 'image/png';
        const hash = computeContentHash(buffer);
        const key = `projects/${job.projectId}/assets/${hash}.png`;
        const upload = await this.storage.upload(key, buffer, mimeType);
        path = upload.key;
        await prisma.asset.create({ data: {
          projectId: job.projectId, fileName: `${hash}.png`, mimeType, sizeBytes: BigInt(buffer.length),
          storageProvider: env.STORAGE_PROVIDER, storagePath: path, sha256: hash,
          metadata: { extractedFromAssetId: sourceAsset.id, role: asset.role },
        } });
      } else {
        const url = asset.url || asset.placeholder;
        if (!url) throw new Error(`Image asset '${id}' has no usable source crop or URL; correct its sourceRect and retry`);
        const inline = await resolveInlineImage(url, env.AI_REQUEST_TIMEOUT_MS);
        buffer = Buffer.from(inline.data, 'base64');
        mimeType = inline.mimeType;
      }
      const url = `data:${mimeType};base64,${buffer.toString('base64')}`;
      asset.url = url; asset.placeholder = url; asset.path = path;
      resolved.set(id,{url,path});
    }
    for (const ref of references) {
      const asset = resolved.get(ref.assetId)!;
      ref.node[ref.key] = asset.url;
      if (ref.key === 'url') { ref.node.imageUrl = asset.url; ref.node.path = asset.path; }
      else ref.node.backgroundImagePath = asset.path;
    }
  }

  public verifyVisualQuality(
    dirDoc: DIRDocument,
    elementorDoc: any,
    options?: { sourceAssetPath?: string; strictFidelity?: boolean; nodeElementIds?: Record<string, string> }
  ): QualityAuditResult {
    if (!dirDoc.pages || !Array.isArray(dirDoc.pages) || dirDoc.pages.length === 0) {
      throw new Error('Quality verification failed: DIR document contains no pages');
    }

    let totalDirNodes = 0;
    let totalSections = 0;

    for (const page of dirDoc.pages) {
      if (!page.sections || !Array.isArray(page.sections) || page.sections.length === 0) {
        throw new Error(`Quality verification failed: Page "${page.id || page.name || 'unnamed'}" contains no sections`);
      }
      for (const sec of page.sections) {
        totalSections++;
        const children = sec.children || (sec as any).nodes || (sec as any).elements;
        if (!children || !Array.isArray(children) || children.length === 0) {
          throw new Error(`Quality verification failed: Section "${sec.id || sec.role || 'unnamed'}" contains 0 elements`);
        }
        totalDirNodes += this.countNodesRecursive(children);
      }
    }

    if (totalDirNodes === 0) {
      throw new Error('Quality verification failed: DIR document contains 0 elements');
    }

    if (!elementorDoc?.content || !Array.isArray(elementorDoc.content) || elementorDoc.content.length === 0) {
      throw new Error('Quality verification failed: Elementor template content is empty');
    }

    let totalContainers = 0;
    let totalWidgets = 0;
    let imageCount = 0;
    let resolvedImageCount = 0;

    const inspectElement = (el: any) => {
      if (el.elType === 'container' || el.elType === 'section' || el.elType === 'column') {
        totalContainers++;
      } else if (el.elType === 'widget') {
        totalWidgets++;
        if (el.widgetType === 'image') {
          imageCount++;
          const url = el.settings?.image?.url;
          if (url && typeof url === 'string' && url.trim().length > 0) {
            if (options?.sourceAssetPath) {
              const rawSrc = options.sourceAssetPath.replace(/^\/?storage\//, '');
              const cleanUrl = url.replace(/^\/?storage\//, '');
              if (cleanUrl === rawSrc) {
                throw new Error(
                  `Quality verification failed: Image widget "${el.id}" was populated with the raw full-page screenshot instead of an extracted sub-asset crop`
                );
              }
            }
            resolvedImageCount++;
          } else {
            throw new Error(`Quality verification failed: Image widget "${el.id}" has no resolved image URL`);
          }
        }
      }
      if (el.elements && Array.isArray(el.elements)) {
        for (const child of el.elements) {
          inspectElement(child);
        }
      }
    };

    for (const rootEl of elementorDoc.content) {
      inspectElement(rootEl);
    }

    if (totalContainers === 0) {
      throw new Error('Quality verification failed: Elementor template contains 0 containers');
    }

    if (totalWidgets === 0) {
      throw new Error('Quality verification failed: Elementor template contains 0 widgets');
    }

    const pageBg = dirDoc.globals?.colors?.background;
    if (pageBg && pageBg !== 'transparent') {
      if (elementorDoc.page_settings?.background_color !== pageBg) {
        logger.warn(
          { expectedBg: pageBg, actualBg: elementorDoc.page_settings?.background_color },
          'Visual quality warning: page settings background does not match DIR globals'
        );
      }
    }

    const heroSection = dirDoc.pages?.[0]?.sections?.find((s) => s.role === 'hero');
    if (heroSection) {
      const hasHeading = (elements: any[]): boolean => {
        for (const el of elements) {
          if (el.widgetType === 'heading' && el.settings?.title) return true;
          if (el.elements && hasHeading(el.elements)) return true;
        }
        return false;
      };
      if (!hasHeading(elementorDoc.content)) {
        logger.warn('Visual quality warning: Hero section does not contain a populated heading widget');
      }
    }

    const correspondenceWarnings = options?.nodeElementIds
      ? auditCorrespondence(dirDoc, elementorDoc, options.nodeElementIds)
      : ['Per-node correspondence was not checked: compiler source mapping is unavailable'];
    const typographyPreserved = !correspondenceWarnings.some(w => w.includes('Typography'));
    const layoutPreserved = Boolean(options?.nodeElementIds);

    return {
      passed: true,
      structuralValidity: 'passed',
      visualFidelity: { status: 'not_measured', reason: 'No WordPress/Elementor render comparison was performed' },
      warnings: correspondenceWarnings,
      totalPages: dirDoc.pages.length,
      totalSections,
      totalDirNodes,
      totalContainers,
      totalWidgets,
      imageCount,
      resolvedImageCount,
      details: `Verified ${totalSections} sections, ${totalDirNodes} DIR elements, ${totalContainers} containers, ${totalWidgets} widgets, ${resolvedImageCount}/${imageCount} resolved images`,
      fidelityAudit: {
        typographyPreserved,
        layoutPreserved,
        noFullScreenshotFallbacks: true,
        imageIntegrityVerified: resolvedImageCount === imageCount,
      },
    };
  }

  private countNodesRecursive(nodes: any[]): number {
    let count = 0;
    for (const node of nodes) {
      count++;
      const children = (node as any).children || (node as any).nodes || (node as any).elements;
      if (children && Array.isArray(children)) {
        count += this.countNodesRecursive(children);
      }
    }
    return count;
  }

  private async updateStatus(jobId: string, status: any, currentStage: any): Promise<void> {
    try {
      await prisma.conversionJob.update({
        where: { id: jobId },
        data: { status, currentStage, lastHeartbeat: new Date() },
      });
    } catch {
      // Job record might have been deleted concurrently
    }
  }
}

let orchestratorInstance: ConversionOrchestrator | null = null;

export function getConversionOrchestrator(): ConversionOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new ConversionOrchestrator();
  }
  return orchestratorInstance;
}
