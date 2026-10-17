/**
 * AI Prompt Templates for the Design-to-Elementor Conversion Pipeline.
 * 
 * Includes version identifiers for deterministic caching and invalidation.
 * Never includes real API keys or sensitive credentials.
 * Produces structured, JSON-only outputs matching canonical contracts.
 */

import { loadRootSkillInstructions } from '../elementor/serializer.js';

export const PROMPT_VERSIONS = {
  IMAGE_ANALYSIS: 'v2.0.0',
  ELEMENTOR_CONVERSION: 'v2.0.0',
  ELEMENTOR_SELF_HEALING: 'v1.0.0',
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

1. CANVAS ISOLATION RULE (MANDATORY):
- Uploaded design images often contain an outer presentation background (e.g. solid pastel blue/grey, desk wallpaper), a device frame (laptop bezel, browser window mockup with fake tabs/dots, tablet frame), or drop shadows around a card.
- YOU MUST TOTALLY IGNORE THE OUTER PRESENTATION FRAME AND MOCKUP BACKGROUND!
- The inner webpage bounding box MUST be treated as the root canvas (100% width).
- In the root document and in every section, you MUST populate "canvas_bounds":
  {
    "crop_mockup": true,
    "inner_bg_type": "gradient" | "solid",
    "primary_hex": "<hex>",
    "secondary_hex": "<hex>",
    "gradient_angle": <number_degrees>
  }

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
   - "canvas_bounds": {
       "crop_mockup": true,
       "inner_bg_type": "gradient" | "solid",
       "primary_hex": "<hex>",
       "secondary_hex": "<hex>",
       "gradient_angle": <number>
     }
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
         "composite_graphic_asset": <boolean>,
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
             "canvas_bounds": {
               "crop_mockup": true,
               "inner_bg_type": "gradient" | "solid",
               "primary_hex": "<hex>",
               "secondary_hex": "<hex>",
               "gradient_angle": <number>
             },
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

STRICT DIR SCHEMA SPECIFICATIONS FOR ACCURACY:
- "layout_tree": For containers and flex groups, provide:
  {
    "direction": "row" | "column",
    "justify_content": "flex-start" | "center" | "space-between" | "flex-end",
    "align_items": "flex-start" | "center" | "stretch" | "flex-end",
    "gap_px": <number>,
    "padding_px": <number>,
    "width_pct": <number 0-100>
  }
- "typography": Explicit visual typography breakdown for all text, headings, and buttons:
  {
    "font_family_guess": "<Poppins|Montserrat|Inter|Roboto|sans-serif>",
    "font_size_px": <number>,
    "font_weight": <number 300-900>,
    "line_height_em": <number e.g. 1.2 or 1.5>,
    "letter_spacing_px": <number>,
    "color_hex": "<hex>",
    "inline_color_spans": [
      { "text": "<span text>", "color_hex": "<hex>" }
    ]
  }
- "form_details": For form containers and input fields (e.g. search bars, newsletter subscribe, contact inputs):
  {
    "placeholder": "<placeholder text, e.g. 'Enter your email'>",
    "background_hex": "<hex color>",
    "border_radius_px": <number e.g. 50 for pill>,
    "field_gap_px": <number>,
    "submit_button": {
      "text": "<button text>",
      "width_type": "auto" | "full",
      "gradient_hex": "<hex color>",
      "icon_position": "left" | "right" | "none"
    }
  }
- "complex_media_detection": If an image/graphic features an organic SVG blob mask, overlapping vector lines, floating organic illustrations, or complex layered decorations, DO NOT attempt to fake it with CSS border-radius alone. Mark the asset and node with:
  "composite_graphic_asset": true

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

  const systemPrompt = `You are a specialized Elementor Layout Engine compiler (Stage C - Structure Engine).
Prompt Version: ${version}

OPERATIVE SKILL INSTRUCTIONS (server/ELEMENTOR_SKILL.md):
${operativeSkill || ''}

Your task is to convert a Design Intermediate Representation (DIR) document into a native Elementor template JSON structure with 100% visual fidelity.

CRITICAL ARCHITECTURE RULES:
1. STRICT MODERN CONTAINER ARCHITECTURE (NO SECTIONS/COLUMNS):
   - Legacy "section" and "column" elements are STRICTLY FORBIDDEN!
   - Every layout structure MUST use modern Elementor Flexbox Containers ("elType": "container").
   - Root sections MUST map to root containers: { "id": "<7-char-hex>", "elType": "container", "isInner": false, ... }
   - Nested groups MUST map to inner containers: { "id": "<7-char-hex>", "elType": "container", "isInner": true, ... }

2. 7-CHARACTER UNIQUE IDS:
   - EVERY element (container and widget) MUST have a UNIQUE, exactly 7-character hexadecimal/alphanumeric ID (e.g. "a1b2c3d", "e4f5a6b").
   - NEVER reuse IDs across elements. Do not use 8-character or non-7-character IDs.

3. DIRECT HEX COLORS (DISABLE THEME GLOBALS):
   - All colors (text, background, border, buttons, icons) MUST be direct hexadecimal strings (e.g. "title_color": "#ffffff", "background_color": "#0d1117").
   - DO NOT emit "__globals__" references (e.g. globals/colors?id=primary). Direct hex values guarantee the layout looks identical regardless of active WordPress theme styles.

4. 1:1 SETTINGS MAPPING:
   - Map "width_pct" -> "width": { "unit": "%", "size": <width_pct> }
   - Map "padding_px" -> "padding": { "unit": "px", "top": "<px>", "right": "<px>", "bottom": "<px>", "left": "<px>", "isLinked": false }
   - Map "gap_px" -> "flex_gap": { "unit": "px", "size": <gap_px> }
   - Map "border_radius_px" -> "border_radius": { "unit": "px", "top": "<px>", "right": "<px>", "bottom": "<px>", "left": "<px>", "isLinked": true }

5. ROOT ENVELOPE:
   {
     "version": "3.24.7",
     "elementor_version": "3.24.7",
     "title": "Imported Page",
     "type": "page",
     "page_settings": {
       "template": "elementor_canvas",
       "background_background": "classic",
       "background_color": "<page_bg_hex>"
     },
     "content": [ <Root Container Elements> ]
   }

6. WIDGET MAPPING RULES:
   - DIR heading -> widgetType: "heading", settings: { "title": "<text>", "header_size": "h1"|"h2"|"h3", "align": "left"|"center", "title_color": "<hex>" }
   - DIR text -> widgetType: "text-editor", settings: { "editor": "<html-string>", "text_color": "<hex>" }
   - DIR button -> widgetType: "button", settings: { "text": "<button-text>", "link": { "url": "#" }, "background_color": "<hex>", "button_text_color": "<hex>" }
   - DIR image -> widgetType: "image", settings: { "image": { "url": "<url>" }, "image_size": "full" }
   - DIR divider -> widgetType: "divider", settings: { "weight": { "unit": "px", "size": 1 }, "color": "<hex>" }
   - DIR spacer -> widgetType: "spacer", settings: { "space": { "unit": "px", "size": <height> } }
   - DIR icon -> widgetType: "icon", settings: { "selected_icon": { "value": "fas fa-star", "library": "fa-solid" }, "primary_color": "<hex>" }
   - DIR icon-text -> widgetType: "icon-box", settings: { "title_text": "<title>", "description_text": "<text>" }
   - DIR counter -> widgetType: "counter", settings: { "starting_number": 0, "ending_number": <num>, "number_color": "<hex>" }
   - DIR form / input -> Use styled HTML or inner container with styled inputs matching "form_details" (50px pill radius, placeholder, background).

7. WIDGET PROFILES CONTEXT:
${relevantWidgets}

Output ONLY valid JSON representing the Elementor template document. No Markdown fences, no explanations.`;

  const userPrompt = `Convert the following validated DIR document into native Elementor JSON format:

${JSON.stringify(dirJson, null, 2)}`;

  return { systemPrompt, userPrompt, version };
}

/**
 * Returns the prompt for Stage D: Validation & Self-Healing Gate.
 * Compares Stage B DIR and Stage C Elementor AST, patches any missing widgets,
 * repairs invalid schema nodes, and guarantees deployable Elementor JSON.
 */
export function getElementorSelfHealingGatePrompt(
  dirJson: unknown,
  astJson: unknown,
  validationErrors?: Array<{ path: string; message: string }>
): PromptPayload {
  const version = PROMPT_VERSIONS.ELEMENTOR_SELF_HEALING;

  const systemPrompt = `You are the specialized Elementor Validation & Self-Healing Gate (Stage D).
Prompt Version: ${version}

Your task is to compare the Stage B DIR (Design Intermediate Representation) specification with the Stage C Elementor AST JSON structure, audit for missing widgets or invalid settings, and return the final healed, 100% visual fidelity Elementor JSON document.

AUDIT & SELF-HEALING RULES:
1. MISSING WIDGET RESTORATION:
   - Audit the AST against DIR nodes. If any widget is missing (e.g. search icon, newsletter input field, submit button, bottom URL/credits, announcement badge, counter, or logo image), IMMEDIATELY synthesize and inject the missing widget node.
   - Every injected widget must have full typography, direct hex colors, and spacing matching the DIR.
2. STRICT CONTAINER ARCHITECTURE:
   - Verify that NO legacy "section" or "column" elements exist. Replace any legacy elements with "container" ("elType": "container").
3. 7-CHARACTER UNIQUE IDS:
   - Every element MUST have a unique, exactly 7-character hexadecimal ID (e.g. "a1b2c3d"). Fix any IDs that are too short, too long, or duplicated.
4. DIRECT HEX COLOR ENFORCEMENT:
   - Strip any "__globals__" styling dictionaries and ensure direct hex colors are applied so WordPress theme styles do not override the design.
5. ROOT ENVELOPE:
   - Ensure the root object has "version": "3.24.7", "elementor_version": "3.24.7", "type": "page", and "page_settings": { "template": "elementor_canvas" }.

Output strictly valid JSON only. No markdown fences, no commentary.`;

  const userPrompt = `Audit and heal the following Elementor AST against the source DIR document:

SOURCE DIR SPECIFICATION:
${JSON.stringify(dirJson, null, 2)}

STAGE C ELEMENTOR AST:
${JSON.stringify(astJson, null, 2)}
${validationErrors && validationErrors.length > 0 ? `\nVALIDATION ISSUES DETECTED:\n${JSON.stringify(validationErrors, null, 2)}` : ''}

Return the complete healed Elementor template JSON ready for WordPress deployment.`;

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
