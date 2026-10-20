/**
 * Deterministic Normalizer for Design Intermediate Representation (DIR)
 *
 * Safely normalizes unambiguous AI output formats to strictly conform to the authoritative DIR schema:
 * 1. Disentangles pages and sections (e.g. sections misplaced directly into pages[]).
 * 2. Converts numeric strings (e.g. "24" or "24px") to numbers on explicitly numeric schema fields.
 * 3. Maps CSS property aliases in styles (e.g. marginTop -> margin.top, gridTemplateColumns -> grid columns).
 * 4. Repairs missing required fields semantically (e.g. text.html from text.text, grid columns).
 * 5. Rejects ambiguous CSS values (e.g. "1.5rem") without corrupting layout intent.
 */

import { DIRDocument, DIRSectionRole, DIRNodeKind } from './types.js';

const VALID_SECTION_ROLES = new Set<DIRSectionRole>([
  'header', 'navigation', 'hero', 'feature', 'content', 'cta',
  'testimonial', 'pricing', 'stats', 'gallery', 'team', 'faq',
  'contact', 'form', 'footer', 'banner', 'logo-bar', 'generic'
]);

const VALID_STYLE_KEYS = new Set([
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'padding', 'margin', 'gap',
  'backgroundColor', 'backgroundImage', 'backgroundGradient', 'backgroundSize', 'backgroundPosition', 'backgroundOverlay',
  'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'textTransform', 'textDecoration', 'color',
  'borderWidth', 'borderColor', 'borderStyle', 'borderRadius',
  'boxShadow', 'textShadow',
  'display', 'position', 'overflow', 'opacity', 'zIndex',
  'flexDirection', 'justifyContent', 'alignItems', 'alignSelf', 'flexGrow', 'flexShrink', 'flexBasis', 'flexWrap'
]);

/**
 * Safely parses an unambiguous numeric string (e.g. "24", "24px", 24).
 * Returns undefined for ambiguous values like "1.5rem", "auto", "inherit".
 */
export function parseNumeric(val: unknown): number | undefined {
  if (typeof val === 'number') {
    return isNaN(val) ? undefined : val;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    // Allow pure digits/decimals, optionally followed by "px"
    const match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(?:px)?$/i);
    if (match) {
      const num = parseFloat(match[1]);
      return isNaN(num) ? undefined : num;
    }
  }
  return undefined;
}

/**
 * Normalizes DIRStyles object, handling numeric strings and CSS alias properties.
 */
export function normalizeStyles(rawStyles: unknown): Record<string, any> {
  if (!rawStyles || typeof rawStyles !== 'object' || Array.isArray(rawStyles)) {
    return {};
  }

  const s = { ...(rawStyles as Record<string, any>) };

  // 1. Explicitly numeric scalar properties
  const numericFields = [
    'fontSize', 'letterSpacing', 'borderWidth', 'gap', 'zIndex',
    'flexGrow', 'flexShrink'
  ];

  for (const field of numericFields) {
    if (s[field] !== undefined) {
      const parsed = parseNumeric(s[field]);
      if (parsed !== undefined) {
        s[field] = parsed;
      }
      // If ambiguous (e.g. "1.5rem"), leave it as-is so strict validation handles/rejects it
    }
  }

  // 2. Opacity (0.0 to 1.0)
  if (s.opacity !== undefined) {
    const parsed = parseNumeric(s.opacity);
    if (parsed !== undefined) {
      s.opacity = Math.max(0, Math.min(1, parsed));
    }
  }

  // 3. Line height (can be number or string)
  if (s.lineHeight !== undefined) {
    const parsed = parseNumeric(s.lineHeight);
    if (parsed !== undefined) {
      s.lineHeight = parsed;
    }
  }

  // 4. Border Radius (number or { topLeft, topRight, bottomRight, bottomLeft })
  if (s.borderRadius !== undefined) {
    const parsed = parseNumeric(s.borderRadius);
    if (parsed !== undefined) {
      s.borderRadius = parsed;
    } else if (typeof s.borderRadius === 'object' && s.borderRadius !== null && !Array.isArray(s.borderRadius)) {
      const corners: Record<string, number> = {};
      for (const c of ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const) {
        if (s.borderRadius[c] !== undefined) {
          const cornerNum = parseNumeric(s.borderRadius[c]);
          if (cornerNum !== undefined) {
            corners[c] = cornerNum;
          }
        }
      }
      s.borderRadius = Object.keys(corners).length > 0 ? corners : undefined;
    }
  }

  // 5. Spacing: Padding
  if (s.padding && typeof s.padding === 'object' && !Array.isArray(s.padding)) {
    const pad: Record<string, number> = {};
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      if (s.padding[side] !== undefined) {
        const parsed = parseNumeric(s.padding[side]);
        if (parsed !== undefined) pad[side] = parsed;
      }
    }
    s.padding = Object.keys(pad).length > 0 ? pad : undefined;
  }

  // 6. Spacing: Margin
  if (s.margin && typeof s.margin === 'object' && !Array.isArray(s.margin)) {
    const mar: Record<string, number> = {};
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      if (s.margin[side] !== undefined) {
        const parsed = parseNumeric(s.margin[side]);
        if (parsed !== undefined) mar[side] = parsed;
      }
    }
    s.margin = Object.keys(mar).length > 0 ? mar : undefined;
  }

  // 7. Map individual CSS margin properties (e.g. marginBottom, marginTop)
  const cssMarginMap: Record<string, 'top' | 'right' | 'bottom' | 'left'> = {
    marginTop: 'top',
    marginRight: 'right',
    marginBottom: 'bottom',
    marginLeft: 'left',
  };

  for (const [cssProp, side] of Object.entries(cssMarginMap)) {
    if (s[cssProp] !== undefined) {
      const parsed = parseNumeric(s[cssProp]);
      if (parsed !== undefined) {
        s.margin = s.margin || {};
        if (s.margin[side] === undefined) {
          s.margin[side] = parsed;
        }
      }
      delete s[cssProp];
    }
  }

  // 8. Map individual CSS padding properties (e.g. paddingTop, paddingBottom)
  const cssPaddingMap: Record<string, 'top' | 'right' | 'bottom' | 'left'> = {
    paddingTop: 'top',
    paddingRight: 'right',
    paddingBottom: 'bottom',
    paddingLeft: 'left',
  };

  for (const [cssProp, side] of Object.entries(cssPaddingMap)) {
    if (s[cssProp] !== undefined) {
      const parsed = parseNumeric(s[cssProp]);
      if (parsed !== undefined) {
        s.padding = s.padding || {};
        if (s.padding[side] === undefined) {
          s.padding[side] = parsed;
        }
      }
      delete s[cssProp];
    }
  }

  // 9. Remove unrecognized CSS keys that violate dirStyles.strict()
  // Specific common CSS keys that models inject into styles:
  const strippedCssKeys = ['top', 'right', 'bottom', 'left', 'gridTemplateColumns', 'objectFit', 'float', 'clear', 'direction', 'width_pct'];
  for (const key of strippedCssKeys) {
    if (s[key] !== undefined && !VALID_STYLE_KEYS.has(key)) {
      delete s[key];
    }
  }

  return s;
}

/**
 * Normalizes a DIRNode and its recursive children.
 */
export function normalizeNode(rawNode: unknown): any {
  if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) {
    return rawNode;
  }

  const node = { ...(rawNode as Record<string, any>) };

  // Base fields
  node.id = node.id && typeof node.id === 'string' ? node.id : `node_${Math.random().toString(36).slice(2, 9)}`;
  node.confidence = typeof node.confidence === 'number'
    ? Math.max(0, Math.min(1, node.confidence))
    : parseNumeric(node.confidence) ?? 0.9;

  // Extract styles properties before normalizing styles
  const rawStyles = node.styles && typeof node.styles === 'object' ? { ...node.styles } : {};

  // Reconcile and hoist layout properties placed inside styles by AI models
  if (rawStyles.direction) {
    const dir = rawStyles.direction === 'row' ? 'row' : 'column';
    if (node.kind === 'container' || node.kind === 'flex-group') {
      node.direction = node.direction || dir;
    }
    rawStyles.flexDirection = rawStyles.flexDirection || dir;
    delete rawStyles.direction;
  }
  if (rawStyles.flexDirection) {
    const dir = rawStyles.flexDirection === 'row' ? 'row' : 'column';
    if (node.kind === 'container' || node.kind === 'flex-group') {
      node.direction = node.direction || dir;
    }
  }
  if (rawStyles.justifyContent) {
    if (node.kind === 'flex-group') {
      node.justifyContent = node.justifyContent || rawStyles.justifyContent;
    }
  }
  if (rawStyles.alignItems) {
    if (node.kind === 'flex-group') {
      node.alignItems = node.alignItems || rawStyles.alignItems;
    }
  }
  if (rawStyles.gap !== undefined) {
    const g = parseNumeric(rawStyles.gap);
    if (g !== undefined) {
      if (node.kind === 'container' || node.kind === 'flex-group' || node.kind === 'grid-group') {
        node.gap = node.gap ?? g;
      }
    }
  }
  if (rawStyles.width_pct !== undefined) {
    const w = parseNumeric(rawStyles.width_pct);
    if (w !== undefined && !rawStyles.width) {
      rawStyles.width = `${w}%`;
    }
    delete rawStyles.width_pct;
  }

  // Reconcile typography into rawStyles
  if (node.typography && typeof node.typography === 'object') {
    const typo = node.typography;
    if (rawStyles.fontSize === undefined && typo.font_size_px !== undefined) {
      rawStyles.fontSize = parseNumeric(typo.font_size_px);
    }
    if (rawStyles.fontWeight === undefined && typo.font_weight !== undefined) {
      rawStyles.fontWeight = typo.font_weight;
    }
    if (rawStyles.fontFamily === undefined && (typo.font_family_guess || typo.font_family)) {
      rawStyles.fontFamily = typo.font_family_guess || typo.font_family;
    }
    if (rawStyles.color === undefined && (typo.color_hex || typo.color)) {
      rawStyles.color = typo.color_hex || typo.color;
    }
    if (rawStyles.lineHeight === undefined && (typo.line_height_em !== undefined || typo.line_height !== undefined)) {
      rawStyles.lineHeight = parseNumeric(typo.line_height_em ?? typo.line_height);
    }
    if (rawStyles.letterSpacing === undefined && (typo.letter_spacing_px !== undefined || typo.letter_spacing !== undefined)) {
      rawStyles.letterSpacing = parseNumeric(typo.letter_spacing_px ?? typo.letter_spacing);
    }
    if (rawStyles.textAlign === undefined && (typo.text_align || typo.textAlign)) {
      rawStyles.textAlign = typo.text_align || typo.textAlign;
    }
  }

  // Reconcile layout_tree into node and rawStyles
  if (node.layout_tree && typeof node.layout_tree === 'object') {
    const lt = node.layout_tree;
    if (lt.direction) {
      const dir = lt.direction === 'row' ? 'row' : 'column';
      if (node.kind === 'container' || node.kind === 'flex-group') {
        node.direction = node.direction || dir;
      }
      rawStyles.flexDirection = rawStyles.flexDirection || dir;
    }
    if (lt.gap_px !== undefined) {
      const g = parseNumeric(lt.gap_px);
      if (g !== undefined) {
        if (node.kind === 'container' || node.kind === 'flex-group' || node.kind === 'grid-group') {
          node.gap = node.gap ?? g;
        }
        rawStyles.gap = rawStyles.gap ?? g;
      }
    }
    if (lt.justify_content || lt.justifyContent) {
      const jc = lt.justify_content || lt.justifyContent;
      if (node.kind === 'flex-group') {
        node.justifyContent = node.justifyContent || jc;
      }
      rawStyles.justifyContent = rawStyles.justifyContent || jc;
    }
    if (lt.align_items || lt.alignItems) {
      const ai = lt.align_items || lt.alignItems;
      if (node.kind === 'flex-group') {
        node.alignItems = node.alignItems || ai;
      }
      rawStyles.alignItems = rawStyles.alignItems || ai;
    }
    if (lt.padding_px !== undefined) {
      const p = parseNumeric(lt.padding_px);
      if (p !== undefined && !rawStyles.padding) {
        rawStyles.padding = { top: p, right: p, bottom: p, left: p };
      }
    }
    if (lt.width_pct !== undefined) {
      const w = parseNumeric(lt.width_pct);
      if (w !== undefined && !rawStyles.width) {
        rawStyles.width = `${w}%`;
      }
    }
  }

  // Sanitize node-level keys that violate strict node schemas
  if (node.kind !== 'flex-group') {
    if (node.justifyContent) {
      rawStyles.justifyContent = rawStyles.justifyContent || node.justifyContent;
      delete node.justifyContent;
    }
    if (node.alignItems) {
      rawStyles.alignItems = rawStyles.alignItems || node.alignItems;
      delete node.alignItems;
    }
  }
  if (node.kind !== 'container' && node.kind !== 'flex-group') {
    delete node.direction;
    delete node.wrap;
  }
  if (node.kind !== 'container' && node.kind !== 'flex-group' && node.kind !== 'grid-group') {
    delete node.gap;
  }

  // Reconcile form_details into rawStyles
  if (node.form_details && typeof node.form_details === 'object') {
    const fd = node.form_details;
    if (rawStyles.backgroundColor === undefined && fd.background_hex) {
      rawStyles.backgroundColor = fd.background_hex;
    }
    if (rawStyles.borderRadius === undefined && fd.border_radius_px !== undefined) {
      rawStyles.borderRadius = parseNumeric(fd.border_radius_px);
    }
    if (rawStyles.gap === undefined && fd.field_gap_px !== undefined) {
      rawStyles.gap = parseNumeric(fd.field_gap_px);
      node.gap = node.gap ?? rawStyles.gap;
    }
  }

  // Kind-specific mappings from styles:
  // 1. Grid group: columns
  if (node.kind === 'grid-group') {
    if (node.columns === undefined) {
      if (rawStyles.gridTemplateColumns) {
        const gtc = String(rawStyles.gridTemplateColumns);
        const repeatMatch = gtc.match(/repeat\((\d+)/i);
        if (repeatMatch) {
          node.columns = parseInt(repeatMatch[1], 10);
        } else {
          const count = gtc.trim().split(/\s+/).length;
          node.columns = count > 1 ? count : 2;
        }
      } else if (Array.isArray(node.children) && node.children.length > 0) {
        node.columns = Math.min(node.children.length, 3);
      } else {
        node.columns = 1;
      }
    } else {
      const parsedCol = parseNumeric(node.columns);
      node.columns = parsedCol && parsedCol > 0 ? Math.floor(parsedCol) : 1;
    }
  }

  // 2. Image: objectFit, width, height, seed
  if (node.kind === 'image') {
    if (!node.objectFit && rawStyles.objectFit) {
      const fit = String(rawStyles.objectFit).toLowerCase();
      if (['cover', 'contain', 'fill', 'none'].includes(fit)) {
        node.objectFit = fit;
      }
    }
    if (node.width !== undefined) {
      const w = parseNumeric(node.width);
      if (w && w > 0) node.width = w; else delete node.width;
    }
    if (node.height !== undefined) {
      const h = parseNumeric(node.height);
      if (h && h > 0) node.height = h; else delete node.height;
    }
    if (node.seed !== undefined) {
      const s = parseNumeric(node.seed);
      if (s !== undefined) node.seed = Math.floor(s); else delete node.seed;
    }
  }

  // 3. Text: html
  if (node.kind === 'text') {
    if (!node.html && node.text) {
      node.html = `<p>${escapeHtml(String(node.text))}</p>`;
    } else if (!node.html) {
      node.html = '<p></p>';
    }
  }

  // 4. Heading: level
  if (node.kind === 'heading') {
    if (node.level === undefined || typeof node.level !== 'number') {
      const parsedLevel = parseNumeric(node.level);
      if (parsedLevel && [1, 2, 3, 4, 5, 6].includes(parsedLevel)) {
        node.level = parsedLevel;
      } else if (typeof node.htmlTag === 'string' && /^h([1-6])$/i.test(node.htmlTag)) {
        node.level = parseInt(RegExp.$1, 10);
      } else {
        node.level = 2;
      }
    }
    const accentWord = node.accentWord || node.accent_word || node.accent?.text;
    if (accentWord && typeof accentWord === 'string') {
      node.accentWord = accentWord;
    }
    const accentColor = node.accentColor || node.accent_color || node.accent?.color;
    if (accentColor && typeof accentColor === 'string') {
      node.accentColor = accentColor;
    }
  }

  // 5. Rating: value, max
  if (node.kind === 'rating') {
    const val = parseNumeric(node.value ?? node.stars ?? node.score ?? node.rating ?? node.count);
    node.value = val !== undefined ? Math.min(5, Math.max(0, val)) : 5;
    if (node.max !== undefined) {
      const m = parseNumeric(node.max);
      node.max = m !== undefined ? m : 5;
    }
    delete node.stars;
    delete node.score;
    delete node.count;
  }

  // 6. Counter: value, suffix, prefix, title
  if (node.kind === 'counter') {
    const val = parseNumeric(node.value ?? node.count ?? node.number ?? node.target);
    node.value = val !== undefined ? val : 100;
    delete node.count;
    delete node.number;
    delete node.target;
  }

  // 7. Progress Bar: value, max, label
  if (node.kind === 'progress-bar') {
    const val = parseNumeric(node.value ?? node.percentage ?? node.percent ?? node.progress);
    node.value = val !== undefined ? Math.min(100, Math.max(0, val)) : 50;
    if (node.max !== undefined) {
      const m = parseNumeric(node.max);
      node.max = m !== undefined ? m : 100;
    }
    delete node.percentage;
    delete node.percent;
    delete node.progress;
  }

  // 8. Spacer: height
  if (node.kind === 'spacer') {
    const h = parseNumeric(node.height);
    node.height = h !== undefined && h > 0 ? h : 20;
  }

  // 9. Badge: text
  if (node.kind === 'badge') {
    if (!node.text) {
      node.text = String(node.label || node.title || node.value || 'Badge');
    }
    delete node.label;
    delete node.title;
    delete node.value;
  }

  // 10. Button: text
  if (node.kind === 'button') {
    if (!node.text) {
      node.text = String(node.label || node.title || 'Button');
    }
    delete node.label;
    delete node.title;
  }

  // 11. Link: text
  if (node.kind === 'link') {
    if (!node.text) {
      node.text = String(node.label || node.title || 'Link');
    }
    delete node.label;
    delete node.title;
  }

  // 12. Icon-Text & List-Item: text
  if (node.kind === 'icon-text' || node.kind === 'list-item') {
    if (!node.text) {
      node.text = String(node.title || node.label || node.value || '');
    }
    if (node.kind === 'icon-text') {
      delete node.label;
      delete node.value;
    }
  }
  node.styles = normalizeStyles(rawStyles);

  // Normalize responsiveOverrides if present
  if (node.responsiveOverrides && typeof node.responsiveOverrides === 'object') {
    const normOverrides: Record<string, any> = {};
    for (const device of ['tablet', 'mobile'] as const) {
      if (node.responsiveOverrides[device]) {
        normOverrides[device] = normalizeStyles(node.responsiveOverrides[device]);
      }
    }
    node.responsiveOverrides = normOverrides;
  }

  // Normalize children recursively
  if (Array.isArray(node.children)) {
    node.children = node.children.map(normalizeNode);
  } else if (['container', 'flex-group', 'grid-group', 'card', 'form'].includes(node.kind)) {
    node.children = [];
  }

  return node;
}

/**
 * Normalizes a DIRSection.
 */
export function normalizeSection(rawSection: unknown): any {
  if (!rawSection || typeof rawSection !== 'object' || Array.isArray(rawSection)) {
    return rawSection;
  }

  let sec = { ...(rawSection as Record<string, any>) };

  sec.id = sec.id && typeof sec.id === 'string' ? sec.id : `sec_${Math.random().toString(36).slice(2, 9)}`;
  sec.confidence = typeof sec.confidence === 'number'
    ? Math.max(0, Math.min(1, sec.confidence))
    : parseNumeric(sec.confidence) ?? 0.9;

  // Validate or fallback role
  if (!sec.role || !VALID_SECTION_ROLES.has(sec.role)) {
    sec.role = 'generic';
  }

  const rawSecStyles = sec.styles && typeof sec.styles === 'object' ? { ...sec.styles } : {};

  // Reconcile canvas_bounds into section background color and gradient
  if (sec.canvas_bounds && typeof sec.canvas_bounds === 'object') {
    if (!rawSecStyles.backgroundColor && sec.canvas_bounds.primary_hex) {
      rawSecStyles.backgroundColor = sec.canvas_bounds.primary_hex;
    }
    const isGrad =
      sec.canvas_bounds.inner_bg_type === 'gradient' ||
      Boolean(sec.canvas_bounds.primary_hex && sec.canvas_bounds.secondary_hex && sec.canvas_bounds.primary_hex !== sec.canvas_bounds.secondary_hex);
    if (isGrad && !rawSecStyles.backgroundGradient) {
      rawSecStyles.backgroundGradient = {
        type: 'linear',
        startColor: sec.canvas_bounds.primary_hex,
        endColor: sec.canvas_bounds.secondary_hex || sec.canvas_bounds.primary_hex,
        angle: sec.canvas_bounds.gradient_angle ?? 180,
      };
    }
  }

  // Reconcile layout_tree into section styles
  if (sec.layout_tree && typeof sec.layout_tree === 'object') {
    const lt = sec.layout_tree;
    if (lt.direction && !rawSecStyles.flexDirection) {
      rawSecStyles.flexDirection = lt.direction === 'row' ? 'row' : 'column';
    }
    if (lt.gap_px !== undefined && rawSecStyles.gap === undefined) {
      rawSecStyles.gap = parseNumeric(lt.gap_px);
    }
    if (lt.padding_px !== undefined && !rawSecStyles.padding) {
      const p = parseNumeric(lt.padding_px);
      if (p !== undefined) {
        rawSecStyles.padding = { top: p, right: p, bottom: p, left: p };
      }
    }
  }

  sec.styles = normalizeStyles(rawSecStyles);

  if (sec.responsiveOverrides && typeof sec.responsiveOverrides === 'object') {
    const normOverrides: Record<string, any> = {};
    for (const device of ['tablet', 'mobile'] as const) {
      if (sec.responsiveOverrides[device]) {
        normOverrides[device] = normalizeStyles(sec.responsiveOverrides[device]);
      }
    }
    sec.responsiveOverrides = normOverrides;
  }

  if (Array.isArray(sec.children)) {
    sec.children = sec.children.map(normalizeNode);
  } else {
    sec.children = [];
  }

  if (!sec.sourceRect && (sec.role === 'header' || sec.role === 'navigation' || sec.id?.includes('header') || sec.id?.includes('nav'))) {
    sec = normalizeHeaderSection(sec);
  }

  return sec;
}

/**
 * Normalizes a header/navigation section into a canonical 3-slot layout:
 * [ Brand Logo (left), Navigation Menu (center), Actions/Buttons (right) ]
 */
function normalizeHeaderSection(sec: any): any {
  sec.role = 'header';
  sec.styles = sec.styles || {};
  sec.styles.flexDirection = 'row';
  sec.styles.justifyContent = sec.styles.justifyContent || 'space-between';
  sec.styles.alignItems = sec.styles.alignItems || 'center';

  if (!Array.isArray(sec.children) || sec.children.length === 0) {
    return sec;
  }

  // 1. Unwrap redundant single wrapper container if it wraps the entire navbar
  let rawChildren = sec.children;
  if (
    rawChildren.length === 1 &&
    ['container', 'flex-group'].includes(rawChildren[0]?.kind) &&
    Array.isArray(rawChildren[0]?.children) &&
    rawChildren[0].children.length >= 2
  ) {
    const wrapper = rawChildren[0];
    if (wrapper.styles) {
      if (wrapper.styles.justifyContent) sec.styles.justifyContent = wrapper.styles.justifyContent;
      if (wrapper.styles.alignItems) sec.styles.alignItems = wrapper.styles.alignItems;
      if (wrapper.styles.padding && !sec.styles.padding) sec.styles.padding = wrapper.styles.padding;
    }
    rawChildren = wrapper.children;
  }

  // 2. Classify items into 3 slots: Logo, MenuLinks, ActionButtons
  const logos: any[] = [];
  const menuItems: any[] = [];
  const actionItems: any[] = [];

  for (let i = 0; i < rawChildren.length; i++) {
    const child = rawChildren[i];
    if (!child) continue;

    const idStr = String(child.id || '').toLowerCase();
    const altStr = String(child.alt || '').toLowerCase();
    const assetIdStr = String(child.assetId || '').toLowerCase();
    const labelStr = String(child.label || '').toLowerCase();
    const isLogo =
      labelStr === 'logo' ||
      idStr.includes('logo') ||
      altStr.includes('logo') ||
      assetIdStr.includes('logo') ||
      (i === 0 && child.kind === 'image');

    if (isLogo) {
      child.label = 'logo';
      child.styles = child.styles || {};
      if (typeof child.styles.width === 'number') {
        child.styles.width = Math.min(260, Math.max(60, child.styles.width));
      } else {
        child.styles.width = 150;
      }
      logos.push(child);
      continue;
    }

    // Check if child text/title indicates a header action or language switcher
    const textLower = String(child.text || child.title || '').trim().toLowerCase();
    const isActionWord = /^(log\s*in|sign\s*in|sign\s*up|register|get\s*started|contact(\s*us)?|book\s*now|en(\s*▾|\s*v|\s*⌄)?)$/i.test(textLower);

    // Check if child is an action button or action link
    if (child.kind === 'button' || isActionWord || (actionItems.length > 0 && (child.kind === 'link' || child.kind === 'text'))) {
      actionItems.push(child);
      continue;
    }

    // Check if child is a container / flex-group
    if (['container', 'flex-group'].includes(child.kind) && Array.isArray(child.children)) {
      const hasButtons = child.children.some((c: any) => c.kind === 'button');
      const hasOnlyLinks = child.children.every((c: any) => c.kind === 'link' || c.kind === 'text' || c.kind === 'icon-text');

      if (hasButtons || idStr.includes('action') || idStr.includes('btn') || idStr.includes('cta')) {
        child.direction = 'row';
        child.label = 'header-actions';
        child.styles = child.styles || {};
        child.styles.flexDirection = 'row';
        child.styles.alignItems = 'center';
        child.styles.justifyContent = 'flex-end';
        child.styles.gap = child.styles.gap ?? child.gap ?? 20;
        actionItems.push(child);
      } else if (hasOnlyLinks || idStr.includes('nav') || idStr.includes('menu') || idStr.includes('link')) {
        child.direction = 'row';
        child.label = 'navigation-menu';
        child.styles = child.styles || {};
        child.styles.flexDirection = 'row';
        child.styles.alignItems = 'center';
        child.styles.gap = child.styles.gap ?? child.gap ?? 32;
        menuItems.push(child);
      } else {
        menuItems.push(child);
      }
      continue;
    }

    // Loose links or text
    if (child.kind === 'link' || child.kind === 'icon-text' || child.kind === 'text') {
      menuItems.push(child);
      continue;
    }

    // If first heading and no logo yet, treat as typography brand logo
    if (i === 0 && child.kind === 'heading' && logos.length === 0) {
      child.label = 'logo';
      logos.push(child);
      continue;
    }

    menuItems.push(child);
  }

  // 3. Reconstruct canonical children: [ Logo, Menu, Actions ]
  const finalChildren: any[] = [];

  // Slot 1: Logo
  if (logos.length > 0) {
    finalChildren.push(logos[0]);
  }

  // Slot 2: Menu
  if (menuItems.length > 0) {
    if (menuItems.length === 1 && ['container', 'flex-group'].includes(menuItems[0].kind)) {
      const m = menuItems[0];
      m.direction = 'row';
      m.label = 'navigation-menu';
      m.styles = m.styles || {};
      m.styles.flexDirection = 'row';
      m.styles.alignItems = 'center';
      m.styles.gap = m.styles.gap ?? m.gap ?? 32;
      finalChildren.push(m);
    } else {
      finalChildren.push({
        id: `${sec.id}_nav_menu`,
        kind: 'flex-group',
        label: 'navigation-menu',
        direction: 'row',
        gap: 32,
        alignItems: 'center',
        justifyContent: 'center',
        styles: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 32,
        },
        children: menuItems,
        confidence: 0.98,
      });
    }
  }

  // Slot 3: Actions / Buttons
  if (actionItems.length > 0) {
    if (actionItems.length === 1 && actionItems[0].kind === 'button') {
      finalChildren.push(actionItems[0]);
    } else if (actionItems.length === 1 && ['container', 'flex-group'].includes(actionItems[0].kind)) {
      const a = actionItems[0];
      a.direction = 'row';
      a.label = 'header-actions';
      a.styles = a.styles || {};
      a.styles.flexDirection = 'row';
      a.styles.alignItems = 'center';
      a.styles.justifyContent = 'flex-end';
      a.styles.gap = a.styles.gap ?? a.gap ?? 20;
      finalChildren.push(a);
    } else {
      // Flatten all action items into a single row flex-group
      const flatActions: any[] = [];
      for (const item of actionItems) {
        if (Array.isArray(item.children)) {
          flatActions.push(...item.children);
        } else {
          flatActions.push(item);
        }
      }
      finalChildren.push({
        id: `${sec.id}_actions_group`,
        kind: 'flex-group',
        label: 'header-actions',
        direction: 'row',
        gap: 20,
        alignItems: 'center',
        justifyContent: 'flex-end',
        styles: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 20,
        },
        children: flatActions,
        confidence: 0.98,
      });
    }
  }

  sec.children = finalChildren;
  return sec;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isSectionLike(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  // A section has role and styles/children, but NOT sections
  return (
    (typeof item.role === 'string' && VALID_SECTION_ROLES.has(item.role as DIRSectionRole)) ||
    (Array.isArray(item.children) && !item.sections)
  );
}

/**
 * Deterministically normalizes a full parsed DIR document before schema validation.
 */
export function normalizeDIR(rawDoc: unknown): any {
  if (!rawDoc || typeof rawDoc !== 'object' || Array.isArray(rawDoc)) {
    return rawDoc;
  }

  const doc = JSON.parse(JSON.stringify(rawDoc));

  doc.version = doc.version || '1.0.0';

  // 1. Meta — prune unrecognized keys to conform to strict Zod schema
  const ALLOWED_META_KEYS = new Set([
    'sourceImageHash', 'sourceWidth', 'sourceHeight', 'analysisProvider',
    'analysisModel', 'analysisTimestamp', 'confidenceScore', 'schemaVersion',
    'promptVersion', 'notes', 'canvas_bounds'
  ]);

  if (doc.meta && typeof doc.meta === 'object' && !Array.isArray(doc.meta)) {
    for (const key of Object.keys(doc.meta)) {
      if (!ALLOWED_META_KEYS.has(key)) {
        delete doc.meta[key];
      }
    }
    doc.meta.schemaVersion = '1.0.0';
    if (doc.meta.sourceWidth !== undefined) doc.meta.sourceWidth = parseNumeric(doc.meta.sourceWidth) ?? doc.meta.sourceWidth;
    if (doc.meta.sourceHeight !== undefined) doc.meta.sourceHeight = parseNumeric(doc.meta.sourceHeight) ?? doc.meta.sourceHeight;
    if (doc.meta.confidenceScore !== undefined) {
      const parsedConf = parseNumeric(doc.meta.confidenceScore);
      doc.meta.confidenceScore = parsedConf !== undefined ? Math.max(0, Math.min(1, parsedConf)) : 0.9;
    }
    if (doc.meta.notes !== undefined && !Array.isArray(doc.meta.notes)) {
      doc.meta.notes = [String(doc.meta.notes)];
    }
  }

  // 2. Breakpoints — normalize array to standard desktop/tablet/mobile object
  if (Array.isArray(doc.breakpoints)) {
    doc.breakpoints = {
      desktop: { min: 1024 },
      tablet: { min: 768, max: 1023 },
      mobile: { min: 0, max: 767 }
    };
  } else if (!doc.breakpoints || typeof doc.breakpoints !== 'object') {
    doc.breakpoints = {
      desktop: { min: 1024 },
      tablet: { min: 768, max: 1023 },
      mobile: { min: 0, max: 767 }
    };
  } else {
    if (!doc.breakpoints.desktop || typeof doc.breakpoints.desktop !== 'object') {
      doc.breakpoints.desktop = { min: 1024 };
    } else {
      doc.breakpoints.desktop.min = parseNumeric(doc.breakpoints.desktop.min) ?? 1024;
      if (doc.breakpoints.desktop.max !== undefined) {
        doc.breakpoints.desktop.max = parseNumeric(doc.breakpoints.desktop.max) ?? doc.breakpoints.desktop.max;
      }
    }
    if (doc.breakpoints.tablet && typeof doc.breakpoints.tablet === 'object') {
      doc.breakpoints.tablet.min = parseNumeric(doc.breakpoints.tablet.min) ?? 768;
      doc.breakpoints.tablet.max = parseNumeric(doc.breakpoints.tablet.max) ?? 1023;
    }
    if (doc.breakpoints.mobile && typeof doc.breakpoints.mobile === 'object') {
      doc.breakpoints.mobile.min = parseNumeric(doc.breakpoints.mobile.min) ?? 0;
      if (doc.breakpoints.mobile.max !== undefined) {
        doc.breakpoints.mobile.max = parseNumeric(doc.breakpoints.mobile.max) ?? 767;
      }
    }
  }

  // 3. Globals — guarantee required colors (background, text) and typography (fontFamilies)
  if (!doc.globals || typeof doc.globals !== 'object' || Array.isArray(doc.globals)) {
    doc.globals = {};
  }

  if (!doc.globals.colors || typeof doc.globals.colors !== 'object' || Array.isArray(doc.globals.colors)) {
    doc.globals.colors = {};
  }
  const defaultBg = doc.canvas_bounds?.primary_hex || '#ffffff';
  doc.globals.colors.background = typeof doc.globals.colors.background === 'string' && doc.globals.colors.background.trim() && doc.globals.colors.background !== '#ffffff'
    ? doc.globals.colors.background
    : defaultBg;
  doc.globals.colors.text = typeof doc.globals.colors.text === 'string' && doc.globals.colors.text.trim()
    ? doc.globals.colors.text
    : '#0f172a';

  if (!doc.globals.typography || typeof doc.globals.typography !== 'object' || Array.isArray(doc.globals.typography)) {
    doc.globals.typography = {};
  }
  if (!Array.isArray(doc.globals.typography.fontFamilies) || doc.globals.typography.fontFamilies.length === 0) {
    doc.globals.typography.fontFamilies = ['Inter', 'sans-serif'];
  }
  if (doc.globals.typography.baseSize !== undefined) {
    doc.globals.typography.baseSize = parseNumeric(doc.globals.typography.baseSize) ?? doc.globals.typography.baseSize;
  }
  if (doc.globals.typography.scale !== undefined) {
    doc.globals.typography.scale = parseNumeric(doc.globals.typography.scale) ?? doc.globals.typography.scale;
  }

  if (doc.globals.spacing && typeof doc.globals.spacing === 'object' && !Array.isArray(doc.globals.spacing)) {
    if (doc.globals.spacing.base !== undefined) {
      doc.globals.spacing.base = parseNumeric(doc.globals.spacing.base) ?? doc.globals.spacing.base;
    }
    if (doc.globals.spacing.sectionGap !== undefined) {
      doc.globals.spacing.sectionGap = parseNumeric(doc.globals.spacing.sectionGap) ?? doc.globals.spacing.sectionGap;
    }
    if (doc.globals.spacing.containerMaxWidth !== undefined) {
      doc.globals.spacing.containerMaxWidth = parseNumeric(doc.globals.spacing.containerMaxWidth) ?? doc.globals.spacing.containerMaxWidth;
    }
  }

  // 4. Assets
  if (Array.isArray(doc.assets)) {
    doc.assets = doc.assets.map((asset: any) => {
      if (!asset || typeof asset !== 'object') return asset;
      const a = { ...asset };
      if (a.confidence !== undefined) {
        const conf = parseNumeric(a.confidence);
        if (conf !== undefined) a.confidence = Math.max(0, Math.min(1, conf));
      }
      if (a.sourceRect && typeof a.sourceRect === 'object') {
        a.sourceRect.x = parseNumeric(a.sourceRect.x) ?? a.sourceRect.x;
        a.sourceRect.y = parseNumeric(a.sourceRect.y) ?? a.sourceRect.y;
        a.sourceRect.width = parseNumeric(a.sourceRect.width) ?? a.sourceRect.width;
        a.sourceRect.height = parseNumeric(a.sourceRect.height) ?? a.sourceRect.height;
      }
      if (a.width !== undefined) {
        const w = parseNumeric(a.width);
        if (w && w > 0) a.width = w; else delete a.width;
      }
      if (a.height !== undefined) {
        const h = parseNumeric(a.height);
        if (h && h > 0) a.height = h; else delete a.height;
      }
      if (a.seed !== undefined) {
        const s = parseNumeric(a.seed);
        if (s !== undefined) a.seed = Math.floor(s); else delete a.seed;
      }
      return a;
    });
  }

  // 5. Pages and Sections Disentanglement (Resolves pages.1 section error)
  if (!Array.isArray(doc.pages) || doc.pages.length === 0) {
    if (Array.isArray(doc.sections) && doc.sections.length > 0) {
      doc.pages = [{
        id: 'page_main',
        name: 'Home',
        sections: doc.sections.map(normalizeSection),
      }];
      delete doc.sections;
    }
  } else {
    // Check if any element in pages is a section-shaped object
    const hasSectionInPages = doc.pages.some(isSectionLike);

    if (hasSectionInPages) {
      const allSections: any[] = [];
      let pageId = 'page_main';
      let pageName = 'Home';

      for (const item of doc.pages) {
        if (isSectionLike(item)) {
          allSections.push(normalizeSection(item));
        } else if (item && typeof item === 'object') {
          if (item.id && typeof item.id === 'string') pageId = item.id;
          if (item.name && typeof item.name === 'string') pageName = item.name;
          if (Array.isArray(item.sections)) {
            allSections.push(...item.sections.map(normalizeSection));
          }
        }
      }

      doc.pages = [{
        id: pageId,
        name: pageName,
        sections: allSections,
      }];
    } else {
      // Each page is a page object
      doc.pages = doc.pages.map((p: any) => {
        if (!p || typeof p !== 'object') return p;
        const page = { ...p };
        if (Array.isArray(page.sections)) {
          page.sections = page.sections.map(normalizeSection);
        }
        return page;
      });
    }
  }

  return doc;
}
