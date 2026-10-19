/**
 * AI Module — Model Capabilities & Vision Input Guards
 * 
 * Defines model capability catalog, vision input validation,
 * and intelligent routing guards to ensure image parts are only
 * dispatched to verified vision-capable models.
 */

import { AIProvider, AICapability } from './types.js';
import { AIProviderError } from '../../lib/errors.js';

export interface ModelCapabilityInfo {
  provider: AIProvider;
  modelId: string;
  supportsImages: boolean;
  supportsJson: boolean;
  notes?: string;
}

export const KNOWN_MODEL_CAPABILITIES: Record<string, ModelCapabilityInfo> = {
  // Groq Models
  'openai/gpt-oss-120b': {
    provider: 'groq',
    modelId: 'openai/gpt-oss-120b',
    supportsImages: false, // DOCUMENTED TEXT-ONLY: Accepts text input and produces text output
    supportsJson: true,
    notes: 'Official designated replacement on Groq for text structure and JSON generation. Deployed for Free/Developer tiers.',
  },
  'llama-3.3-70b-versatile': {
    provider: 'groq',
    modelId: 'llama-3.3-70b-versatile',
    supportsImages: false,
    supportsJson: true,
    notes: 'DEPRECATED/DECOMMISSIONED: Officially decommissioned on Groq Aug 16, 2026. Returns 404 / access error.',
  },
  'llama-3.1-8b-instant': {
    provider: 'groq',
    modelId: 'llama-3.1-8b-instant',
    supportsImages: false,
    supportsJson: true,
  },
  'llama-3.2-11b-vision-preview': {
    provider: 'groq',
    modelId: 'llama-3.2-11b-vision-preview',
    supportsImages: true,
    supportsJson: true,
  },
  'llama-3.2-90b-vision-preview': {
    provider: 'groq',
    modelId: 'llama-3.2-90b-vision-preview',
    supportsImages: true,
    supportsJson: true,
  },

  // Gemini Models
  'gemini-3.5-flash-lite': {
    provider: 'gemini',
    modelId: 'gemini-3.5-flash-lite',
    supportsImages: true,
    supportsJson: true,
    notes: 'High-throughput, fast multimodal vision model with high availability on Google Gemini API.',
  },
  'gemini-3.5-flash': {
    provider: 'gemini',
    modelId: 'gemini-3.5-flash',
    supportsImages: true,
    supportsJson: true,
    notes: 'Gemini flash vision model.',
  },
  'gemini-flash-lite-latest': {
    provider: 'gemini',
    modelId: 'gemini-flash-lite-latest',
    supportsImages: true,
    supportsJson: true,
    notes: 'Latest flash lite alias for high availability fallback.',
  },
  'gemini-3.8-flash': {
    provider: 'gemini',
    modelId: 'gemini-3.8-flash',
    supportsImages: true,
    supportsJson: true,
    notes: 'Designated stable multimodal Gemini model for vision and layout analysis.',
  },
  'gemini-2.5-flash': {
    provider: 'gemini',
    modelId: 'gemini-2.5-flash',
    supportsImages: true,
    supportsJson: true,
  },
  'gemini-2.0-flash': {
    provider: 'gemini',
    modelId: 'gemini-2.0-flash',
    supportsImages: true,
    supportsJson: true,
  },
  'gemini-1.5-flash': {
    provider: 'gemini',
    modelId: 'gemini-1.5-flash',
    supportsImages: true,
    supportsJson: true,
  },
  'gemini-1.5-pro': {
    provider: 'gemini',
    modelId: 'gemini-1.5-pro',
    supportsImages: true,
    supportsJson: true,
    notes: 'Legacy / obsolete model; may return 404 NOT_FOUND on v1beta API.',
  },

  // OpenRouter Models
  'anthropic/claude-3.5-sonnet': {
    provider: 'openrouter',
    modelId: 'anthropic/claude-3.5-sonnet',
    supportsImages: true,
    supportsJson: true,
  },
  'google/gemini-2.0-flash-001': {
    provider: 'openrouter',
    modelId: 'google/gemini-2.0-flash-001',
    supportsImages: true,
    supportsJson: true,
  },
  'openai/gpt-4o': {
    provider: 'openrouter',
    modelId: 'openai/gpt-4o',
    supportsImages: true,
    supportsJson: true,
  },
  'openai/gpt-4o-mini': {
    provider: 'openrouter',
    modelId: 'openai/gpt-4o-mini',
    supportsImages: true,
    supportsJson: true,
  },
  'openrouter/free': {
    provider: 'openrouter',
    modelId: 'openrouter/free',
    supportsImages: false, // Never assume openrouter/free is vision-capable or deterministic
    supportsJson: true,
    notes: 'Dynamic free tier: unstable, non-deterministic, not guaranteed vision-capable.',
  },
};

/**
 * Checks whether a given model identifier supports multimodal image input.
 */
export function isModelImageCapable(modelId: string, provider?: AIProvider): boolean {
  if (!modelId) return false;
  const normalized = modelId.toLowerCase().trim();

  // 1. Direct registry lookup
  const known = KNOWN_MODEL_CAPABILITIES[normalized];
  if (known) {
    return known.supportsImages;
  }

  // 2. OpenRouter free tier guard — never assume vision capable
  if (normalized.includes('free') || normalized === 'openrouter/free') {
    return false;
  }

  // 3. Provider heuristics
  if (provider === 'gemini' || normalized.startsWith('gemini-')) {
    return true;
  }

  if (normalized.includes('vision') || normalized.includes('gpt-4o') || normalized.includes('claude-3')) {
    return true;
  }

  return false;
}

/**
 * Validates an AIRequest before dispatch, ensuring image payloads are NEVER sent to text-only models.
 */
export function validateRequestCapabilities(
  provider: AIProvider,
  modelId: string,
  hasImagePayload: boolean
): void {
  if (hasImagePayload && !isModelImageCapable(modelId, provider)) {
    throw new AIProviderError(
      `Model '${modelId}' on provider '${provider}' does not support image input. Image bytes/parts can only be dispatched to verified vision-capable models.`,
      provider,
      false
    );
  }
}

