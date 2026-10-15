/**
 * AI Prompt Templates for the Design-to-Elementor Conversion Pipeline.
 * 
 * Includes version identifiers for deterministic caching and invalidation.
 * Never includes real API keys or sensitive credentials.
 * Produces structured, JSON-only outputs matching canonical contracts.
 */

import { loadRootSkillInstructions } from '../elementor/serializer.js';

export const PROMPT_VERSIONS = {
  IMAGE_ANALYSIS: 'v1.6.0',
  ELEMENTOR_CONVERSION: 'v1.2.0',
  DIR_REPAIR: 'v1.1.0',
  SECTION_REPAIR: 'v1.0.0',
} as const;

export interface ImageAnalysisInfo {
  width: number;
  height: number;
  mimeType: string;
  sha256: string;
  isTiled?: boolean;
  tileIndex?: number;
  totalTiles?: number;
  overlapY?: number;
  assetId?: string;
}

export interface PromptPayload {
  systemPrompt: string;
  userPrompt: string;
  version: string;
}

/**
 * Returns the prompt for analyzing a design image and producing a canonical DIR JSON document.
 */
export function getImageAnalysisPrompt(
  imageInfo: ImageAnalysisInfo,
  _dirSchemaSummary?: string
): PromptPayload {
  const version = PROMPT_VERSIONS.IMAGE_ANALYSIS;

  const supportedSectionRoles = [
    'header', 'navigation', 'hero', 'feature', 'content', 'cta',
    'testimonial', 'pricing', 'stats', 'gallery', 'team', 'faq',
    'contact', 'form', 'footer', 'banner', 'logo-bar', 'generic'
  ].join(', ');

  const supportedNodeKinds = [
    'container', 'flex-group', 'grid-group', 'heading', 'text', 'button',
    'image', 'icon', 'icon-text', 'link', 'list', 'list-item', 'divider',
    'spacer', 'card', 'form', 'input', 'video', 'map', 'social-icons',
    'counter', 'progress-bar', 'tabs', 'accordion', 'rating', 'badge', 'unknown'
  ].join(', ');

  const tilingContext = imageInfo.isTiled
    ? `TILING CONTEXT: This is vertical slice ${imageInfo.tileIndex ?? 0 + 1} of ${imageInfo.totalTiles ?? 1} with an overlap of ${imageInfo.overlapY ?? 0}px. Identify sections within this slice and note partial sections near top/bottom boundaries.`
    : `SINGLE IMAGE: This is the full webpage screenshot (${imageInfo.width}x${imageInfo.height}px). Analyze the full vertical hierarchy.`;

  const systemPrompt = `You are an expert design-to-code vision system specialized in website layout understanding.
Prompt Version: ${version}

Your task is to analyze the provided webpage screenshot and generate a Design Intermediate Representation (DIR) JSON document.
Output MUST be strict, valid JSON with NO commentary, NO markdown fences, and NO conversational text.

STAGE A (PERCEPTION) vs STAGE B (CANONICAL DIR):
- STAGE A: Distinguish directly observed visual facts (exact colors, visible text, layout flow, button labels, asset bounding boxes) from inferred responsive behavior.
- STAGE B: Assemble these observations into a strict DIRDocument v1.0.0.
- When responsive behavior is observed or inferred (e.g. multi-column desktops reflowing to stacked mobile columns), you may supply optional "responsiveOverrides" on any node or section:
  "responsiveOverrides": {
    "tablet": { "direction": "column", "fontSize": 32 },
    "mobile": { "direction": "column", "fontSize": 24, "padding": { "top": 16, "bottom": 16, "left": 16, "right": 16 } }
  }

DIR SCHEMA REQUIREMENTS:
1. Root object must contain:
   - "version": "1.0.0"
   - "meta": {
       "sourceImageHash": "${imageInfo.sha256}",
       "sourceWidth": ${imageInfo.width},
       "sourceHeight": ${imageInfo.height},
       "analysisProvider": "ai",
       "analysisModel": "vision",
       "analysisTimestamp": "${new Date().toISOString()}",
       "confidenceScore": <number between 0.0 and 1.0>,
       "schemaVersion": "1.0.0",
       "promptVersion": "${version}",
       "notes": [<string>]
     }
   - "breakpoints": {
       "desktop": { "min": 1024 },
       "tablet": { "min": 768, "max": 1023 },
       "mobile": { "min": 320, "max": 767 }
     }
   - "globals": {
       "colors": {
         "background": "<hex>",
         "text": "<hex>",
         "primary": "<hex>",
         "secondary": "<hex>",
         "accent": "<hex>",
         "surface": "<hex>",
         "border": "<hex>"
       },
       "typography": {
         "fontFamilies": ["<font-family>"],
         "headingFont": "<font-family>",
         "bodyFont": "<font-family>",
         "baseSize": 16,
         "scale": 1.2
       },
       "spacing": {
         "unit": "px",
         "base": 8,
         "sectionGap": 64,
         "containerMaxWidth": 1200
       }
     }
   - "assets": [
       {
         "id": "asset_<unique_id>",
         "type": "image" | "icon" | "logo" | "background" | "placeholder",
         "role": "<short-description>",
         "confidence": <0.0-1.0>,
         "sourceRect": { "x": <number>, "y": <number>, "width": <number>, "height": <number> }
       }
     ]
   - "pages": [
       {
         "id": "page_main",
         "name": "Home",
         "sections": [
           {
             "id": "sec_<unique_id>",
             "role": "<supported_section_role>",
             "label": "<descriptive-name>",
             "confidence": <0.0-1.0>,
             "styles": {
               "backgroundColor": "<hex/rgba>",
               "padding": { "top": <number>, "bottom": <number>, "left": <number>, "right": <number> }
             },
             "children": [<supported_nodes>]
           }
         ]
       }
     ]

CRITICAL HIERARCHY RULES:
- "pages" is an array of Page objects: [{ "id": "page_main", "name": "Home", "sections": [...] }].
- Sections MUST be placed inside "pages[0].sections", NEVER directly in "pages"!
- Do not place section objects { "role", "styles", "children" } directly into "pages[]".

CRITICAL STYLES & NUMERIC RULES:
- All dimensions, spacing, and typography numbers in "styles" (fontSize, lineHeight, letterSpacing, borderWidth, gap, opacity, zIndex) MUST be bare numbers (e.g. 16, 24, 1.2), NEVER strings like "16px" or "24".
- "padding" and "margin" MUST be objects { "top": <number>, "right": <number>, "bottom": <number>, "left": <number> } with numeric values.
- "borderRadius" MUST be a number (e.g. 8) or { "topLeft": <number>, "topRight": <number>, "bottomRight": <number>, "bottomLeft": <number> }.
- DO NOT put raw CSS properties directly in "styles" (e.g. do NOT use gridTemplateColumns, marginBottom, marginTop, objectFit, top, right in styles).
- For 'grid-group': "columns" is a required positive integer on the node itself (e.g. "columns": 3), NOT inside styles.
- For 'text': "html" is a required string (e.g. "html": "<p>Content</p>").
- For 'container' and 'flex-group': "children" is a required array of nodes.
- For 'heading': "text" (string) and "level" (integer 1-6) are required.

CRITICAL ASSET & BOUNDING BOX RULES:
- For every asset in "assets", "sourceRect" coordinates MUST strictly lie within the image dimensions:
  x >= 0, y >= 0, width > 0, height > 0, and x + width <= ${imageInfo.width}, y + height <= ${imageInfo.height}.
- Never provide coordinates outside the image frame.

CRITICAL VISUAL FIDELITY & LAYOUT ACCURACY:
- CANVAS & SECTION BACKGROUNDS: Faithfully capture dark themes! If the page background is dark or near-black (e.g. #050a04, #0a0f0d, #111827), you MUST specify this exact color in "globals.colors.background" and the hero section "styles.backgroundColor". NEVER omit the background or leave it transparent/white for dark designs.
- HEADER & NAVIGATION BAR: Structure the header horizontally ("direction": "row", "justifyContent": "space-between", "alignItems": "center") containing:
  1. Logo / brand mark (e.g. text heading or logo image).
  2. Navigation menu links: group links together in a container/flex-group (e.g. "Home", "Features", "Pricing", "About").
  3. Action CTA button (e.g. "Get Started").
- ANNOUNCEMENT BADGES & PILLS: Hero notification badges (e.g. "A trusted modern fintech platform") should be structured as a 'badge' node with "text", or a 'container' with full pill border radius (9999), light accent background color (e.g. #b7f34c), and dark contrasting text (#060b05).
- HEADLINE HIERARCHY & TEXT CONTRAST: Preserve the primary headline (e.g. "Simplify your financial\\nManagement") as an H1 heading with appropriate font size (e.g. 48-64), center or left alignment matching the design, and high-contrast color (e.g. #ffffff against dark backgrounds). Ensure all white/light text has explicit high-contrast color styles.
- HERO GRAPHICS & PHOTOGRAPHY: If the hero area features an illustration, 3D artwork, athletic photograph, model, gym equipment, or product screenshot, define an asset in the root "assets" array with "sourceRect": { "x": <number>, "y": <number>, "width": <number>, "height": <number> } indicating its bounding box in the original image, and insert an 'image' node referencing this asset via "assetId".
- CIRCULAR STATISTICS & METRIC BADGES: For metrics and statistics (e.g. "+70% Fitness Progress", "500+ Members", circular stat cards), structure them as a 'container' or 'flex-group' with "direction": "column", centered alignment, and children consisting of a 'counter' node ("value": <number>, "suffix": "<string>", "prefix": "<string>", "styles": { "color": "<hex>", "fontSize": <number>, "fontWeight": 700 }) and a 'text' node for the label. If the visual badge is circular, specify "borderRadius": 9999 and matching numeric "width" and "height" in "styles".
- HIGH-IMPACT CTA BUTTONS: Prominent action buttons (e.g. orange #ff5e14 or vibrant accents) must have explicit "backgroundColor", contrasting text "color" (#ffffff), padding, and "borderRadius".

SUPPORTED SECTION ROLES:
${supportedSectionRoles}

SUPPORTED NODE KINDS:
${supportedNodeKinds}

NODE REQUIREMENTS:
- Every node MUST have: "id" (unique string), "kind" (one of the supported kinds), "confidence" (0.0 to 1.0), "styles" (object).
- For 'heading': include "text" (string) and "level" (1|2|3|4|5|6).
- For 'text': include "html" (string with paragraph/span content) and optional "text".
- For 'button': include "text" (string), optional "variant" ('primary'|'secondary'|'outline'|'ghost'|'link').
- For 'container' and 'flex-group': include "direction" ('row'|'column'), optional "gap" (number), and "children" (array of nodes).
- For 'image': include "alt" (string), optional "objectFit" ('cover'|'contain'|'fill'|'none'), optional "aspectRatio", and optional "assetId" referencing one in root "assets".
- For 'icon' or 'icon-text': include "iconName", "text", etc.

CONFIDENCE SCORING:
- Assign 0.9-1.0 for clearly legible headers, buttons, prominent text, and distinct background cards.
- Assign 0.6-0.8 for subtle typography, ambiguous icons, or inferred responsive flex directions.
- Assign below 0.6 only if visual evidence is partially occluded. Do not invent non-existent copy; use safe generic placeholders when unclear.`;

  const userPrompt = `${tilingContext}

Analyze the layout, section hierarchy, visual styling (colors, typography, spacing), and content of this image.
Return the complete, canonical DIR JSON document strictly conforming to version 1.0.0. Return strictly valid JSON only.`;

  return { systemPrompt, userPrompt, version };
}

export function getElementorConversionPrompt(
  dirJson: unknown,
  widgetProfiles?: Record<string, unknown>,
  skillInstructions?: string
): PromptPayload {
  const version = PROMPT_VERSIONS.ELEMENTOR_CONVERSION;

  let operativeSkill = skillInstructions;
  if (!operativeSkill) {
    try {
      operativeSkill = loadRootSkillInstructions().content;
    } catch {
      // ignore
    }
  }

  const relevantWidgets = widgetProfiles
    ? JSON.stringify(widgetProfiles, null, 2)
    : 'Common Elementor widgets: container (flexbox/grid layout), heading, text-editor, button, image, icon, icon-box, divider, spacer';

  const systemPrompt = `You are a specialized Elementor Layout Engine compiler.
Prompt Version: ${version}

OPERATIVE SKILL INSTRUCTIONS (server/ELEMENTOR_SKILL.md):
${operativeSkill || ''}

Your task is to convert a Design Intermediate Representation (DIR) document into a native Elementor template JSON structure.

ELEMENTOR JSON SPECIFICATION:
1. Root Envelope:
   {
     "version": "0.4",
     "title": "Imported Template",
     "type": "page",
     "content": [ <Root Container Elements> ]
   }

2. Container-Based Architecture (Elementor Flexbox Containers):
   - Every section from the DIR must map to a root container:
     {
       "id": "<7-character-alphanumeric-id>",
       "elType": "container",
       "isInner": false,
       "settings": {
         "content_width": "boxed" | "full",
         "flex_direction": "column" | "row",
         "flex_gap": { "unit": "px", "size": <number> },
         "background_background": "classic",
         "background_color": "<hex-color>",
         "padding": { "unit": "px", "top": "<px>", "right": "<px>", "bottom": "<px>", "left": "<px>", "isLinked": false }
       },
       "elements": [ <Child Widgets or Inner Containers> ]
     }
   - Nested layouts should use inner containers ("isInner": true, "elType": "container").

3. Widget Mapping Rules:
   - DIR heading -> widgetType: "heading", settings: { "title": "<text>", "header_size": "h1"|"h2"|"h3", "align": "left"|"center" }
   - DIR text -> widgetType: "text-editor", settings: { "editor": "<html-string>" }
   - DIR button -> widgetType: "button", settings: { "text": "<button-text>", "link": { "url": "#" }, "button_type": "default" }
   - DIR image -> widgetType: "image", settings: { "image": { "url": "https://placehold.co/600x400" }, "image_size": "large" }
   - DIR divider -> widgetType: "divider", settings: { "weight": { "unit": "px", "size": 1 } }
   - DIR spacer -> widgetType: "spacer", settings: { "space": { "unit": "px", "size": <height> } }
   - DIR icon -> widgetType: "icon", settings: { "selected_icon": { "value": "fas fa-star", "library": "fa-solid" } }
   - DIR icon-text -> widgetType: "icon-box", settings: { "title_text": "<title>", "description_text": "<text>" }

4. Responsive Controls & Suffixes (Elementor 4.3.5):
   - Elementor uses unadorned controls for desktop, with "_tablet" and "_mobile" suffixes:
     - Flex direction: "flex_direction", "flex_direction_tablet": "column", "flex_direction_mobile": "column"
     - Grid columns: "grid_columns_grid", "grid_columns_grid_tablet": { "unit": "fr", "size": 2 }, "grid_columns_grid_mobile": { "unit": "fr", "size": 1 }
     - Font size: "typography_font_size", "typography_font_size_tablet", "typography_font_size_mobile"
     - Spacing: "padding_tablet", "padding_mobile", "margin_tablet", "margin_mobile"
     - Viewport clamping: Ensure containers and images have "width_mobile": { "unit": "%", "size": 100 } where fixed desktop widths would exceed 390px mobile viewport.

5. Element ID Requirements:
   - EVERY element (container and widget) MUST have a UNIQUE, 7-character hexadecimal or alphanumeric ID (e.g. "a1b2c3d", "e4f5a6b").
   - NEVER reuse IDs across elements.

6. Widget Profiles Context:
${relevantWidgets}

Output ONLY valid JSON representing the Elementor template document. No Markdown fences, no explanations.`;

  const userPrompt = `Convert the following validated DIR document into native Elementor JSON format:

${JSON.stringify(dirJson, null, 2)}`;

  return { systemPrompt, userPrompt, version };
}

/**
 * Returns the prompt for repairing an invalid DIR JSON document given validation errors.
 */
export function getDIRRepairPrompt(
  dirJson: unknown,
  errors: Array<{ path: string; message: string; code?: string }>
): PromptPayload {
  const version = PROMPT_VERSIONS.DIR_REPAIR;

  const errorSummary = errors
    .map((e, index) => `${index + 1}. Path: "${e.path || 'root'}" - Error: ${e.message} (Code: ${e.code || 'UNKNOWN'})`)
    .join('\n');

  const systemPrompt = `You are a precise JSON repair engineer specialized in the Design Intermediate Representation (DIR) schema.
Prompt Version: ${version}

Your task is to perform minimal, targeted repairs on a malformed DIR document to make it fully compliant with the schema.

RULES:
1. Fix ONLY the specific reported validation errors.
2. Preserve all existing valid nodes, content, text, styles, and section hierarchy.
3. HIERARCHY: "pages" MUST be an array of Page objects: [{ "id": "page_main", "name": "Home", "sections": [...] }]. Sections belong ONLY inside pages[0].sections, NEVER directly inside pages[]!
4. NUMERICS: All dimensions, fontSize, borderWidth, letterSpacing, and spacing numbers in styles MUST be bare numbers, NEVER strings.
5. REQUIRED FIELDS:
   - 'grid-group': "columns" is a required positive integer.
   - 'text': "html" is a required string.
   - 'container' and 'flex-group': "children" is a required array.
   - 'heading': "text" and "level" (1-6) are required.
6. NO CSS PROPERTIES IN STYLES: Do not put gridTemplateColumns, marginBottom, marginTop, objectFit, top, right directly in styles.
7. Return ONLY the repaired JSON document. No commentary, no apologies, no conversational text.`;

  const userPrompt = `The following DIR document failed schema validation with these specific errors:

VALIDATION ERRORS:
${errorSummary}

ORIGINAL DIR DOCUMENT:
${JSON.stringify(dirJson, null, 2)}

Provide the complete repaired DIR JSON document that resolves all of the above errors. Output strictly valid JSON only.`;

  return { systemPrompt, userPrompt, version };
}

/**
 * Returns the prompt for repairing a single isolated DIRSection to conserve tokens and avoid truncation.
 */
export function getSectionRepairPrompt(
  sectionJson: unknown,
  errors: Array<{ path: string; message: string; code?: string }>
): PromptPayload {
  const version = PROMPT_VERSIONS.SECTION_REPAIR;

  const errorSummary = errors
    .map((e, index) => `${index + 1}. Path: "${e.path || 'section'}" - Error: ${e.message}`)
    .join('\n');

  const systemPrompt = `You are a precise JSON repair engineer specialized in repairing a single DIRSection object.
Prompt Version: ${version}

Your task is to repair the provided DIRSection object to strictly conform to the DIR schema.

SECTION REQUIREMENTS:
- Section must have: "id" (string), "role" (valid role like 'hero', 'content', 'header', 'footer', 'cta', 'generic'), "confidence" (0.0-1.0), "styles" (object), "children" (array of nodes).
- All numbers in styles (fontSize, borderWidth, padding.*, margin.*, gap) MUST be bare numbers, NEVER strings.
- 'grid-group': must have "columns" (number).
- 'text': must have "html" (string).
- 'heading': must have "text" (string) and "level" (number 1-6).
- 'container' and 'flex-group': must have "children" (array).
- No CSS properties (marginBottom, gridTemplateColumns, etc.) directly in styles.
- Return ONLY the repaired Section JSON object. No commentary, no markdown fences.`;

  const userPrompt = `The following DIRSection failed validation with these errors:

VALIDATION ERRORS:
${errorSummary}

ORIGINAL SECTION:
${JSON.stringify(sectionJson, null, 2)}

Return the single repaired DIRSection JSON object resolving all errors.`;

  return { systemPrompt, userPrompt, version };
}
