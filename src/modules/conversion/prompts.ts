/**
 * AI Prompt Templates for the Design-to-Elementor Conversion Pipeline.
 * 
 * Includes version identifiers for deterministic caching and invalidation.
 * Never includes real API keys or sensitive credentials.
 * Produces structured, JSON-only outputs matching canonical contracts.
 */

import { loadRootSkillInstructions } from '../elementor/serializer.js';

export const PROMPT_VERSIONS = {
  IMAGE_ANALYSIS: 'v2.1.0',
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
  skillInstructions?: string
): PromptPayload {
  const version = PROMPT_VERSIONS.IMAGE_ANALYSIS;

  let operativeSkill = skillInstructions;
  if (!operativeSkill) {
    try {
      operativeSkill = loadRootSkillInstructions().content;
    } catch {
      // fallback if file not found in test context
    }
  }

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

  const systemPrompt = `You are an expert design-to-code vision system specialized in website layout understanding for native Elementor conversion.
Prompt Version: ${version}

${operativeSkill ? `OPERATIVE ELEMENTOR CONVERSION SKILL INSTRUCTIONS (server/ELEMENTOR_SKILL.md):
${operativeSkill}

` : ''}Your task is to analyze the provided webpage screenshot and generate a Design Intermediate Representation (DIR) JSON document.
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
         "fontFamilies": ["<observed Google Font names, e.g. Plus Jakarta Sans, Inter, Poppins, Montserrat, Roboto, Outfit, Playfair Display>"],
         "headingFont": "<primary font for display & headings, e.g. Plus Jakarta Sans, Poppins, Outfit, Playfair Display>",
         "bodyFont": "<primary font for paragraphs, links, and buttons, e.g. Inter, Plus Jakarta Sans, Roboto>",
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
- "typography": Comprehensive visual typography breakdown for all text, headings, and buttons:
  {
    "font_family_guess": "<canonical font name, e.g. Plus Jakarta Sans | Inter | Poppins | Montserrat | Roboto | Outfit | Playfair Display>",
    "font_size_px": <number, bare integer e.g. 15, 24, 48>,
    "font_weight": <number 400 | 500 | 600 | 700 | 800>,
    "line_height_em": <number e.g. 1.15 for headings, 1.6 for body copy>,
    "letter_spacing_px": <number e.g. -1 for large titles, 1.5 for uppercase subtitles>,
    "text_transform": "uppercase" | "capitalize" | "lowercase" | "none",
    "color_hex": "<exact text color sampled from image, e.g. #FFFFFF on dark theme, #182135 on light>",
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
- CANVAS & SECTION BACKGROUNDS (GRADIENTS & TRUE HUES):
  Faithfully capture page backgrounds with strict chromatic accuracy!
  - BACKGROUND GRADIENTS: Inspect if the background has a gradient, radial aura, or smooth vertical transition (e.g. shifting from royal navy #1B2248 at top to deep midnight navy #141B3C at bottom).
    When observed, YOU MUST populate:
    "canvas_bounds": {
      "crop_mockup": true,
      "inner_bg_type": "gradient",
      "primary_hex": "#1B2248",
      "secondary_hex": "#141B3C",
      "gradient_angle": 180
    }
    and on the section styles:
    "styles": {
      "backgroundColor": "#1B2248",
      "backgroundGradient": {
        "type": "linear",
        "startColor": "#1B2248",
        "endColor": "#141B3C",
        "angle": 180
      }
    }
  - NEVER COLLAPSE NAVY/SLATE TO PITCH BLACK: If a background has blue, indigo, or slate undertones (e.g. #1B2248, #182044, #151C38), sample the true dark blue hue! Never round it to flat pitch black (#000000).

- CHROMATIC FIDELITY FOR BUTTONS & ACCENTS (NO TAILWIND PRESET SNAPPING):
  - SAMPLE ACTUAL PIXEL COLORS: Never lazily snap colors to generic Tailwind presets (such as #fde047 or #facc15)!
  - PASTEL PEACH / CARAMEL / APRICOT / GOLD: If a button or accent is warm pastel peach, apricot, caramel, beige, cream, or sand (e.g. #E7C69F, #E8B788, #DEB285, #E2B17A, #F5D0A9), output that EXACT warm hex code!
    DO NOT output neon yellow (#FDE047, #FACC15, or #FFFF00) unless the element is literally a high-visibility neon yellow highlighter!
  - BUTTON BORDER RADIUS: Always specify button border radius! If rounded rectangle, set "borderRadius": 8. If a pill CTA (e.g. "Get Started" or search pill), set "borderRadius": 50 or 9999.

- NAVIGATION MENU STYLING ON DARK THEMES:
  - Menu links on dark themes are typically soft slate / light grey (#CBD5E1, #B4BCD0, #94A3B8) for inactive links, with the active link (e.g. "Home") highlighted in white (#FFFFFF) or warm accent (#DEB285).
  - Do NOT output harsh stark #FFFFFF for all inactive nav links when the design uses softer, elegant slate tones.

- INTEGRATED SEARCH & NEWSLETTER FORM PILL:
  - When an email/search input is followed by a "Get Started" or "Subscribe" button in a single cohesive row:
    - Left Input: "styles": { "backgroundColor": "rgba(255, 255, 255, 0.08)", "color": "#FFFFFF", "borderRadius": { "topLeft": 50, "bottomLeft": 50, "topRight": 0, "bottomRight": 0 } }
    - Right Button: "styles": { "backgroundColor": "<sampled accent hex>", "borderRadius": { "topLeft": 0, "bottomLeft": 0, "topRight": 50, "bottomRight": 50 } }
- HEADER & NAVIGATION BAR:
  If the uploaded design contains a top navigation bar (logo, links, and/or action buttons):
  YOU MUST ALWAYS define a dedicated section at the very top: "id": "sec_header", "role": "header".
  The header section MUST be laid out horizontally: "direction": "row", "justifyContent": "space-between", "alignItems": "center".
  It MUST be cleanly separated into 3 distinct parts in its "children" array (or 2 parts if no CTA button):
  1. Brand Logo (Slot 1, far left): If visual mark or graphic, define a cropped logo asset in root "assets" with exact "sourceRect" and reference it with an 'image' node with "label": "logo" and pixel dimensions (e.g. "styles": { "width": 120-180, "height": 30-50 }). If typography brand, a 'heading' node.
  2. Navigation Menu Links (Slot 2, center): A container/flex-group with "id": "nav_menu", "label": "navigation-menu", "direction": "row", "gap": 28-36, "alignItems": "center" containing individual 'link' nodes for each menu link (e.g. "Home", "Services", "About Us", "Contact"). NEVER merge menu links into the logo or button.
  3. Header CTA & Actions (Slot 3, far right): A 'button' node (e.g. "Start a project ->", "Join Now") or a horizontal flex-group with "label": "header-actions", "direction": "row", "gap": 16, "alignItems": "center" if there are multiple action items (e.g. "Login" link + "Sign up" button).
  DO NOT omit the header section or merge navbar items into the hero section!
- 2-COLUMN HERO SPLIT (CONTENT VS VISUAL):
  When a design features copy/headline/CTA/metrics on one side and a person, photo, or 3D graphic on the other side, YOU MUST structure the hero content as a 2-column horizontal container ("direction": "row", "justifyContent": "space-between", "alignItems": "center"):
  - Left Container (Content, width ~50-60%): Contains the eyebrow badge/tagline, headline (H1), body text, CTA button group, and statistics metrics.
  - Right Container (Visual, width ~40-50%): Contains the 'image' node referencing the hero photo asset.
  NEVER stack the hero image underneath all headline and body text when the design visually places them side-by-side!
  NOTE: If the design is a centered, single-column hero (e.g. centered headline, subtitle, search/input, or full-width banner), maintain a centered single-column container ("direction": "column", "alignItems": "center"). DO NOT force a 2-column split without visual evidence.
- SIDE-BY-SIDE BUTTON PAIRS (PRIMARY + SECONDARY):
  When there are two action buttons (e.g. "Start Your Project" + "Explore Our Work", or "Haven't you started yet? Start Now"):
  Group them inside a horizontal container ("direction": "row", "alignItems": "center", "gap": 16-20). Do not stack buttons vertically unless the uploaded design is explicitly vertical.
- HERO GRAPHICS & PHOTOGRAPHY CROPPING:
  For any athletic photograph, model, artwork, 3D shape, avatar cluster, or client review badge, define an asset in the root "assets" array with EXACT pixel bounding box:
  "sourceRect": { "x": <number>, "y": <number>, "width": <number>, "height": <number> }
  Coordinates must be strictly accurate so the cropping engine can extract the real artwork instead of generating a dummy blank rectangle.
- STATISTICS & METRICS ROW:
  When numbers are arranged in columns or a horizontal bar (e.g. "120+ Projects", "15+ Countries", "4.9/5 Rating", "95% Returning", or circular stats "10k", "20", "500"):
  Structure them as a container with "direction": "row", "justifyContent": "space-between" or "gap": 24-32.
  When statistics are circular badges (e.g. orange circles with bold white numbers and text label underneath):
  Each stat item MUST be a vertical container ("direction": "column", "alignItems": "center", "gap": 12-16) containing:
  1. A 'counter' node with "value" (number), "suffix" (e.g. 'k'), and "styles" specifying "borderRadius": 9999, "backgroundColor": "<hex>", "color": "#ffffff", "fontSize": 32-40, "fontWeight": 800.
  2. A 'text' or 'heading' node for the descriptive label (e.g. "Happy Clients").
- DECORATIVE BADGES, CAPSULES & ACCENT STRIPS:
  Do not omit secondary decorative shapes (e.g. floating orange capsules with dotted patterns, gradient bottom strips, or arched photo frames). Register them in the root "assets" array with exact "sourceRect" and place them as 'image' nodes or styled containers in the section layout.
- HIGH-IMPACT CTA BUTTONS:
  Buttons must preserve exact visual styles: dark navy/black background (#0B192C) with white text, or vibrant orange/lime accent (#ff5e14, #22c55e), appropriate "borderRadius" (e.g. 50 or 9999 for pill buttons, 8 for rounded rect), and padding. For outline buttons (e.g. transparent with colored border), set "variant": "outline", "styles.backgroundColor": "transparent", "styles.borderColor": "<hex>", "styles.borderWidth": 1.

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
     "version": "0.4",
     "elementor_version": "4.3.5",
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
   - Ensure the root object has "version": "0.4", "elementor_version": "4.3.5", "type": "page", and "page_settings": { "template": "elementor_canvas" }.

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
