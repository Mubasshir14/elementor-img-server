/**
 * Elementor Module — Serializer & Skill Loader
 * Loads authoritative root instructions from server/ELEMENTOR_SKILL.md
 * and serializes Elementor templates to official envelopes.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { ElementorDocument, SkillPackResult } from './types.js';
import { getRegistry } from './registry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function serializeElementorTemplate(doc: ElementorDocument): string {
  const envelope = {
    version: doc.version || '0.4',
    title: doc.title || 'Exported Template',
    type: doc.type || 'page',
    content: doc.content || [],
    page_settings: doc.page_settings || {
      template: 'elementor_canvas',
    },
  };

  return JSON.stringify(envelope, null, 2);
}

/**
 * Loads the primary authoritative Elementor conversion skill instructions
 * from server/ELEMENTOR_SKILL.md.
 * 
 * Fails clearly if the file is missing or unreadable, guaranteeing
 * that generation always operates against the authoritative root skill.
 */
export function loadRootSkillInstructions(customPath?: string): {
  content: string;
  filePath: string;
  hash: string;
} {
  const candidatePaths = customPath
    ? [customPath]
    : [
        path.resolve(process.cwd(), 'ELEMENTOR_SKILL.md'),
        path.resolve(process.cwd(), 'ELEMTOR_SKILL.md'),
        path.resolve(process.cwd(), 'server/ELEMENTOR_SKILL.md'),
        path.resolve(process.cwd(), 'server/ELEMTOR_SKILL.md'),
        path.resolve(__dirname, '../../../ELEMENTOR_SKILL.md'),
        path.resolve(__dirname, '../../../ELEMTOR_SKILL.md'),
        path.resolve(__dirname, '../../../../server/ELEMENTOR_SKILL.md'),
        path.resolve(__dirname, '../../../../server/ELEMTOR_SKILL.md'),
      ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      try {
        const content = fs.readFileSync(candidate, 'utf-8');
        const hash = crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
        return {
          content,
          filePath: candidate,
          hash,
        };
      } catch (err: any) {
        throw new Error(
          `Failed to read root Elementor skill instructions at ${candidate}: ${err.message}`
        );
      }
    }
  }

  throw new Error(
    "Required root skill instruction file 'server/ELEMENTOR_SKILL.md' is missing or unreadable. " +
    "This file must be present at the server root as the primary Elementor-generation skill."
  );
}

export function loadSkillPack(skillDirPath?: string, rootSkillPath?: string): SkillPackResult {
  const rootInstructions = loadRootSkillInstructions(rootSkillPath);

  const targetDir = skillDirPath || path.resolve(__dirname, '../../skills/elementor');
  const registry = getRegistry();
  const warnings: string[] = [];
  const missingProfiles: string[] = [];
  const schemaMismatches: string[] = [];

  let hash = rootInstructions.hash;
  let version = '1.0.0';
  let name = 'Elementor Skill Pack';

  try {
    const registryPath = path.join(targetDir, 'widget-registry.json');
    if (fs.existsSync(registryPath)) {
      const raw = fs.readFileSync(registryPath, 'utf-8');
      const combined = rootInstructions.content + raw;
      hash = crypto.createHash('sha256').update(combined).digest('hex').substring(0, 16);
      const data = JSON.parse(raw);
      version = data.version || version;
      name = data.name || name;

      if (Array.isArray(data.widgets)) {
        for (const item of data.widgets) {
          if (!registry.has(item.slug)) {
            missingProfiles.push(item.slug);
          }
        }
      }
    } else {
      warnings.push(`Skill registry not found at: ${registryPath}`);
    }
  } catch (err: any) {
    warnings.push(`Error loading skill pack: ${err.message}`);
  }

  return {
    meta: {
      name,
      version,
      hash,
      instructionHash: rootInstructions.hash,
    },
    registry,
    profilesCount: registry.getAll().length,
    sourceDir: targetDir,
    operativeInstructions: rootInstructions.content,
    instructionPath: rootInstructions.filePath,
    warnings,
    missingProfiles,
    schemaMismatches,
  };
}
