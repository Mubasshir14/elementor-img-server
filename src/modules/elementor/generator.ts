/**
 * Elementor Module — Generator
 * Converts DIR JSON to native Elementor Document JSON structure
 */

import crypto from 'node:crypto';
import type {
  DIRDocument,
  DIRNode,
  DIRSection,
  DIRStyles,
  DIRSpacing,
  DIRHeadingNode,
  DIRTextNode,
  DIRButtonNode,
  DIRImageNode,
  DIRIconNode,
  DIRIconTextNode,
  DIRListNode,
  DIRDividerNode,
  DIRSpacerNode,
  DIRCounterNode,
  DIRProgressBarNode,
  DIRSocialIconsNode,
  DIRTabsNode,
  DIRAccordionNode,
} from '../dir/types.js';
import type {
  ElementorDocument,
  ElementorElement,
  ConversionReport,
  ConversionOptions,
  ConversionDiagnostic,
} from './types.js';
import { getRegistry } from './registry.js';
import { getAuthoritativeElementorVersion } from './serializer.js';

export function generateElementId(): string {
  return crypto.randomBytes(4).toString('hex').slice(0, 7);
}

export function isDarkColor(colorStr?: string): boolean {
  if (!colorStr) return false;
  if (colorStr.startsWith('#')) {
    const hex = colorStr.replace('#', '');
    const r = parseInt(hex.length === 3 ? hex[0] + hex[0] : hex.slice(0, 2), 16);
    const g = parseInt(hex.length === 3 ? hex[1] + hex[1] : hex.slice(2, 4), 16);
    const b = parseInt(hex.length === 3 ? hex[2] + hex[2] : hex.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return false;
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.5;
  }
  return false;
}

export function canonicalizeFontFamily(font?: string): string {
  if (!font || typeof font !== 'string') return 'Plus Jakarta Sans';
  const clean = font.replace(/['"]/g, '').trim();
  const lower = clean.toLowerCase();

  // Specific Google Fonts mapping
  if (lower.includes('jakarta')) return 'Plus Jakarta Sans';
  if (lower.includes('inter')) return 'Inter';
  if (lower.includes('poppins')) return 'Poppins';
  if (lower.includes('roboto mono')) return 'Roboto Mono';
  if (lower.includes('roboto')) return 'Roboto';
  if (lower.includes('montserrat')) return 'Montserrat';
  if (lower.includes('outfit')) return 'Outfit';
  if (lower.includes('playfair')) return 'Playfair Display';
  if (lower.includes('merriweather')) return 'Merriweather';
  if (lower.includes('dm sans') || lower.includes('dmsans')) return 'DM Sans';
  if (lower.includes('lato')) return 'Lato';
  if (lower.includes('open sans') || lower.includes('opensans')) return 'Open Sans';
  if (lower.includes('raleway')) return 'Raleway';
  if (lower.includes('work sans') || lower.includes('worksans')) return 'Work Sans';
  if (lower.includes('space gro')) return 'Space Grotesk';
  if (lower.includes('syne')) return 'Syne';
  if (lower.includes('clash')) return 'Clash Display';
  if (lower.includes('satoshi')) return 'Satoshi';
  if (lower.includes('manrope')) return 'Manrope';
  if (lower.includes('urbanist')) return 'Urbanist';

  // Generic categories
  if (lower.includes('sans-serif') || lower.includes('sans')) return 'Inter';
  if (lower.includes('serif')) return 'Playfair Display';
  if (lower.includes('mono')) return 'Roboto Mono';
  if (lower.includes('display')) return 'Outfit';

  return clean;
}

export function getEffectiveBackgroundColor(nodeStyles?: DIRStyles, dir?: DIRDocument): string {
  if (nodeStyles?.backgroundColor && nodeStyles.backgroundColor !== 'transparent') {
    return nodeStyles.backgroundColor;
  }
  return dir?.globals?.colors?.background || dir?.globals?.colors?.surface || '#ffffff';
}

export class ElementorGenerator {
  private registry = getRegistry();
  private widgetsUsed = new Set<string>();
  private unsupportedFeatures = new Set<string>();
  private warnings: string[] = [];
  private diagnostics: ConversionDiagnostic[] = [];
  private elementCount = 0;
  private containerCount = 0;
  private widgetCount = 0;
  private explicitResponsiveCount = 0;
  private inferredResponsiveCount = 0;
  private options: ConversionOptions;
  private idCounter = 0;
  private nodeElementIds: Record<string, string> = {};
  private sourceByElement = new Map<string, DIRNode | DIRSection>();
  private nextId(): string { return (++this.idCounter).toString(16).padStart(7, '0'); }
  private dimension(value: string | number): { unit: string; size: number } {
    if (typeof value === 'number') return { unit: 'px', size: value };
    const match = value.match(/^(-?\d+(?:\.\d+)?)(px|%|em|rem|vw|vh)?$/);
    if (!match) throw new Error(`Unsupported measured dimension '${value}'`);
    return { unit: match[2] || 'px', size: Number(match[1]) };
  }

  constructor(options: ConversionOptions = {}) {
    this.options = {
      preferContainers: true,
      targetProfile: 'core',
      ...options,
    };
  }

  public convert(dir: DIRDocument): { document: ElementorDocument; report: ConversionReport } {
    // Some legacy widget converters normalize local values; never mutate the caller's DIR.
    dir = structuredClone(dir);
    if (dir.pages.length !== 1) throw new Error('Elementor page compilation requires exactly one DIR page');
    this.idCounter = 0;
    this.nodeElementIds = {};
    this.sourceByElement.clear();
    this.widgetsUsed.clear();
    this.unsupportedFeatures.clear();
    this.warnings = [];
    this.diagnostics = [];
    this.elementCount = 0;
    this.containerCount = 0;
    this.widgetCount = 0;
    this.explicitResponsiveCount = 0;
    this.inferredResponsiveCount = 0;

    const page = dir.pages[0];
    const content: ElementorElement[] = [];

    if (page && page.sections) {
      for (const section of page.sections) {
        const sectionContainer = this.convertSection(section, dir);
        if (sectionContainer) {
          content.push(sectionContainer);
        }
      }
    }

    // Only explicit DIR responsive overrides are emitted. Inherit desktop otherwise.
    const finalize = (element: ElementorElement): void => {
      const source = this.sourceByElement.get(element.id);
      for (const key of Object.keys(element.settings)) {
        if (/_(tablet|mobile)$/.test(key)) delete element.settings[key];
      }
      if (source?.responsiveOverrides) this.applyResponsiveOverrides(source.responsiveOverrides, element.settings, element.elType === 'container');
      element.elements?.forEach(finalize);
    };
    content.forEach(finalize);
    const normalizeControls = (el: ElementorElement): void => {
      if (el.elType === 'widget') {
        for (const device of ['', '_tablet', '_mobile']) {
          if (el.settings[`margin${device}`]) { el.settings[`_margin${device}`] = el.settings[`margin${device}`]; delete el.settings[`margin${device}`]; }
          if (el.settings[`padding${device}`]) {
            const key = el.widgetType === 'button' ? `text_padding${device}` : `_padding${device}`;
            el.settings[key] = el.settings[`padding${device}`]; delete el.settings[`padding${device}`];
          }
          if (el.widgetType === 'button' && el.settings[`button_padding${device}`]) {
            el.settings[`text_padding${device}`] = el.settings[`button_padding${device}`]; delete el.settings[`button_padding${device}`];
          }
        }
        if (el.widgetType === 'image' && el.settings.border_radius) {
          el.settings.image_border_radius = el.settings.border_radius; delete el.settings.border_radius;
        }
      }
      el.elements?.forEach(normalizeControls);
    };
    content.forEach(normalizeControls);
    this.inferredResponsiveCount = 0;
    const pageBg = dir.globals?.colors?.background || dir.globals?.colors?.surface || '#ffffff';
    const authoritative = getAuthoritativeElementorVersion();

    const rawGlobalGrad = (dir.globals?.colors as any)?.backgroundGradient;
    const isCanvasGradient =
      Boolean(rawGlobalGrad) ||
      dir.canvas_bounds?.inner_bg_type === 'gradient' ||
      Boolean(dir.canvas_bounds?.primary_hex && dir.canvas_bounds?.secondary_hex && dir.canvas_bounds.primary_hex !== dir.canvas_bounds.secondary_hex);

    const pageSettings: Record<string, any> = {
      template: 'elementor_canvas',
      background_background: isCanvasGradient ? 'gradient' : 'classic',
      background_color: dir.canvas_bounds?.primary_hex || pageBg,
    };

    if (isCanvasGradient) {
      let startColor = dir.canvas_bounds?.primary_hex || pageBg;
      let endColor = dir.canvas_bounds?.secondary_hex || pageBg;
      let angle = dir.canvas_bounds?.gradient_angle ?? 180;

      if (typeof rawGlobalGrad === 'object' && rawGlobalGrad !== null) {
        startColor = rawGlobalGrad.startColor || startColor;
        endColor = rawGlobalGrad.endColor || endColor;
        angle = rawGlobalGrad.angle ?? angle;
      } else if (typeof rawGlobalGrad === 'string') {
        const hexMatches = rawGlobalGrad.match(/#[0-9a-fA-F]{3,8}/g);
        if (hexMatches && hexMatches.length >= 2) {
          startColor = hexMatches[0];
          endColor = hexMatches[1];
        }
      }

      pageSettings.background_color = startColor;
      pageSettings.background_color_b = endColor;
      pageSettings.background_gradient_type = 'linear';
      pageSettings.background_gradient_angle = {
        unit: 'deg',
        size: angle,
      };
      pageSettings.background_color_stop = { unit: '%', size: 0 };
      pageSettings.background_color_b_stop = { unit: '%', size: 100 };
    }

    const document: ElementorDocument = {
      version: '0.4',
      elementor_version: dir.meta?.elementorVersion || authoritative.elementorVersion,
      wp_version: authoritative.wpVersion,
      title: page?.name || 'Imported Design',
      type: 'page',
      page_settings: pageSettings,
      content,
    };

    this.diagnostics.push({
      level: 'info',
      code: 'RESPONSIVE_GENERATION',
      message: `Generated responsive settings: ${this.explicitResponsiveCount} explicit overrides, ${this.inferredResponsiveCount} inferred adaptations across desktop, tablet, and mobile.`,
      details: {
        explicitOverridesCount: this.explicitResponsiveCount,
        inferredOverridesCount: this.inferredResponsiveCount,
        devicesTargeted: ['desktop', 'tablet', 'mobile'],
      },
    });

    const report: ConversionReport = {
      nodeElementIds: { ...this.nodeElementIds },
      widgetsUsed: Array.from(this.widgetsUsed),
      unsupportedFeatures: Array.from(this.unsupportedFeatures),
      warnings: this.warnings,
      elementCount: this.elementCount,
      containerCount: this.containerCount,
      totalContainers: this.containerCount,
      widgetCount: this.widgetCount,
      totalWidgets: this.widgetCount,
      diagnostics: this.diagnostics,
      responsiveStats: {
        explicitOverridesCount: this.explicitResponsiveCount,
        inferredOverridesCount: this.inferredResponsiveCount,
        devicesTargeted: ['desktop', 'tablet', 'mobile'],
      },
    };

    return { document, report };
  }

  private convertSection(section: DIRSection, dir: DIRDocument): ElementorElement {
    this.containerCount++;
    this.elementCount++;

    const pageBg = dir.globals?.colors?.background || dir.globals?.colors?.surface || '#ffffff';
    const containerMaxWidth = dir.globals?.spacing?.containerMaxWidth ?? dir.meta?.sourceWidth ?? 1200;
    const isHeader = section.role === 'header' || section.role === 'navigation';
    const settings: Record<string, any> = {
      container_type: 'flex',
      flex_direction: isHeader ? 'row' : 'column',
      content_width: section.styles?.maxWidth || dir.globals?.spacing?.containerMaxWidth ? 'boxed' : 'full',
      boxed_width: { unit: 'px', size: containerMaxWidth, sizes: [] },
      boxed_width_tablet: { unit: 'px', size: Math.min(768, containerMaxWidth), sizes: [] },
      boxed_width_mobile: { unit: 'px', size: 360, sizes: [] },
      _section_role: section.role,
    };
    if (isHeader) {
      settings.flex_justify_content = 'space-between';
      settings.flex_align_items = 'center';
      settings.flex_wrap = 'nowrap';
      settings.flex_direction_tablet = 'row';
      settings.flex_direction_mobile = 'row';
      settings.flex_wrap_mobile = 'wrap';
      if (!settings.padding) {
        settings.padding = { unit: 'px', top: '16', right: '32', bottom: '16', left: '32', isLinked: false };
        settings.padding_tablet = { unit: 'px', top: '14', right: '20', bottom: '14', left: '20', isLinked: false };
        settings.padding_mobile = { unit: 'px', top: '12', right: '16', bottom: '12', left: '16', isLinked: false };
      }
    }

    this.applyStylesToSettings(section.styles, settings, true);

    if (section.responsiveOverrides) {
      this.applyResponsiveOverrides(section.responsiveOverrides, settings, true);
      this.explicitResponsiveCount++;
    }

    const secBounds = section.canvas_bounds || dir.canvas_bounds;
    const rawSecGrad = (section.styles as any)?.backgroundGradient;
    const isSecGradient =
      Boolean(rawSecGrad) ||
      secBounds?.inner_bg_type === 'gradient' ||
      Boolean(secBounds?.primary_hex && secBounds?.secondary_hex && secBounds.primary_hex !== secBounds.secondary_hex);

    if (isSecGradient && (!settings.background_color || settings.background_color === 'transparent' || rawSecGrad)) {
      let startColor = secBounds?.primary_hex || section.styles?.backgroundColor || pageBg;
      let endColor = secBounds?.secondary_hex || pageBg;
      let angle = secBounds?.gradient_angle ?? 180;

      if (typeof rawSecGrad === 'object' && rawSecGrad !== null) {
        startColor = rawSecGrad.startColor || startColor;
        endColor = rawSecGrad.endColor || endColor;
        angle = rawSecGrad.angle ?? angle;
      } else if (typeof rawSecGrad === 'string') {
        const hexMatches = rawSecGrad.match(/#[0-9a-fA-F]{3,8}/g);
        if (hexMatches && hexMatches.length >= 2) {
          startColor = hexMatches[0];
          endColor = hexMatches[1];
        }
      }

      settings.background_background = 'gradient';
      settings.background_color = startColor;
      settings.background_color_b = endColor;
      settings.background_gradient_type = 'linear';
      settings.background_gradient_angle = { unit: 'deg', size: angle };
      settings.background_color_stop = { unit: '%', size: 0 };
      settings.background_color_b_stop = { unit: '%', size: 100 };
    } else if (!settings.background_color || settings.background_color === 'transparent') {
      settings.background_background = 'classic';
      settings.background_color = pageBg;
    }

    const elements: ElementorElement[] = [];
    for (const child of (section.children || [])) {
      const el = this.convertNode(child, dir);
      if (el) elements.push(el);
    }

    const element: ElementorElement = { id: this.nextId(), elType: 'container', settings, elements };
    this.nodeElementIds[section.id] = element.id;
    this.sourceByElement.set(element.id, section);
    return element;
  }

  private convertNode(node: DIRNode, dir: DIRDocument): ElementorElement | null {
    const element = this.convertNodeContent(node, dir);
    if (element) {
      if (element.elType === 'widget') {
        if (node.styles?.margin) element.settings._margin = this.mapSpacing(node.styles.margin);
        if (node.styles?.padding && node.kind !== 'button') element.settings._padding = this.mapSpacing(node.styles.padding);
        if (node.styles?.width !== undefined && node.kind !== 'image') {
          element.settings._element_width = 'custom';
          element.settings._element_custom_width = this.dimension(node.styles.width);
        }
      }
      this.nodeElementIds[node.id] = element.id;
      this.sourceByElement.set(element.id, node);
    }
    return element;
  }

  private convertNodeContent(node: DIRNode, dir: DIRDocument): ElementorElement | null {
    if (!node) return null;

    switch ((node as any).kind) {
      case 'container':
      case 'flex-group':
      case 'grid-group':
      case 'card':
      case 'form':
        return this.convertContainerNode(node, dir);

      case 'heading':
        return this.convertHeadingNode(node as DIRHeadingNode, dir);

      case 'text':
        return this.convertTextNode(node as DIRTextNode, dir);

      case 'button':
        return this.convertButtonNode(node as DIRButtonNode, dir);

      case 'image':
        return this.convertImageNode(node as DIRImageNode, dir);

      case 'icon':
        return this.convertIconNode(node as DIRIconNode);

      case 'icon-text':
        return this.convertIconBoxNode(node as DIRIconTextNode, dir);

      case 'list':
        return this.convertListNode(node as DIRListNode);

      case 'divider':
        return this.convertDividerNode(node as DIRDividerNode);

      case 'spacer':
        return this.convertSpacerNode(node as DIRSpacerNode);

      case 'counter':
        return this.convertCounterNode(node as DIRCounterNode, dir);

      case 'progress-bar':
        return this.convertProgressNode(node as DIRProgressBarNode);

      case 'social-icons':
        return this.convertSocialIconsNode(node as DIRSocialIconsNode);

      case 'tabs':
        return this.convertTabsNode(node as DIRTabsNode, dir);

      case 'accordion':
        return this.convertAccordionNode(node as DIRAccordionNode, dir);

      case 'map':
        return this.convertMapNode(node);

      case 'video':
        return this.convertVideoNode(node);

      case 'rating':
        return this.convertRatingNode(node);

      case 'link':
        return this.convertLinkAsButton(node, dir);

      case 'badge':
        return this.convertBadgeAsHeading(node, dir);

      case 'list-item':
        return this.convertTextNode({
          ...node,
          kind: 'text',
          html: `<p>${(node as any).text || ''}</p>`,
        } as DIRTextNode, dir);

      case 'input':
        return this.convertInputNode(node, dir);

      case 'image-box':
        return this.convertImageBoxNode(node as any, dir);

      case 'testimonial':
        return this.convertTestimonialNode(node as any, dir);

      case 'toggle':
        return this.convertToggleNode(node as any, dir);

      case 'gallery':
      case 'image-gallery':
        return this.convertGalleryNode(node as any, dir);

      case 'unknown':
      default:
        this.unsupportedFeatures.add(`node_kind:${node.kind}`);
        this.warnings.push(`Fallback applied for node kind: ${node.kind}`);
        return this.convertFallbackNode(node);
    }
  }

  private convertContainerNode(node: any, dir: DIRDocument): ElementorElement {
    this.containerCount++;
    this.elementCount++;

    // Special mapping for navigation link groups: render as an inline icon-list navigation widget
    const isNavMenu =
      node.label === 'navigation-menu' ||
      (node as any).role === 'navigation-menu' ||
      (Array.isArray(node.children) &&
        node.children.length > 0 &&
        node.children.every((c: any) => c.kind === 'link' || c.kind === 'text' || c.kind === 'icon-text'));

    if (isNavMenu && !node.sourceRect) {
      this.widgetCount++;
      this.widgetsUsed.add('icon-list');

      const iconList = (node.children || []).map((c: any) => ({
        _id: this.nextId().slice(0, 7),
        text: c.text || c.title || (c.kind === 'text' ? (c.html ? c.html.replace(/<[^>]*>/g, '') : '') : '') || 'Link',
        link: { url: c.url || '#' },
        selected_icon: { value: '', library: '' },
      }));

      const firstChildStyles = node.children?.[0]?.styles || {};
      const navFont = canonicalizeFontFamily(
        firstChildStyles.fontFamily ||
        dir?.globals?.typography?.bodyFont ||
        dir?.globals?.typography?.headingFont ||
        'Plus Jakarta Sans'
      );
      const effBg = getEffectiveBackgroundColor(node.styles, dir);
      const isDark = isDarkColor(effBg);
      const defaultMenuColor = isDark ? '#ffffff' : '#1e293b';
      const menuTextColor = firstChildStyles.color || (node.styles as any)?.color || defaultMenuColor;
      const menuFontSize = typeof firstChildStyles.fontSize === 'number' ? firstChildStyles.fontSize : 15;
      const menuFontWeight = String(firstChildStyles.fontWeight || '500');

      const menuGap = typeof node.gap === 'number' ? node.gap : 32;

      // Calculate required width to ensure inline items never wrap onto multiple lines
      const totalChars = iconList.reduce((sum: number, item: any) => sum + (item.text?.length || 0), 0);
      const estTextWidth = totalChars * (menuFontSize * 0.72);
      const estGapsWidth = Math.max(0, iconList.length - 1) * menuGap;
      const estTotalWidth = Math.ceil(estTextWidth + estGapsWidth + 56);

      return {
        id: this.nextId(),
        elType: 'widget',
        widgetType: 'icon-list',
        settings: {
          view: 'inline',
          icon_list: iconList,
          text_color: menuTextColor,
          space_between: { unit: 'px', size: menuGap },
          space_between_tablet: { unit: 'px', size: Math.max(16, Math.round(menuGap * 0.75)) },
          space_between_mobile: { unit: 'px', size: Math.max(12, Math.round(menuGap * 0.5)) },
          typography_typography: 'custom',
          typography_font_family: navFont,
          typography_font_size: { unit: 'px', size: menuFontSize },
          typography_font_weight: menuFontWeight,
          align_self: 'center',
          _element_width: 'custom',
          _element_custom_width: { unit: 'px', size: estTotalWidth },
          _element_width_tablet: 'initial',
          _element_width_mobile: 'initial',
          _flex_grow: 0,
          _flex_shrink: 0,
          _flex_size: 'auto',
          width: { unit: 'px', size: estTotalWidth },
          width_tablet: { unit: 'initial', size: '' },
          width_mobile: { unit: 'initial', size: '' },
        },
        elements: [],
      };
    }

    const isGrid = node.kind === 'grid-group';
    const settings: Record<string, any> = {
      container_type: isGrid ? 'grid' : 'flex',
    };

    const lt = (node as any).layout_tree;

    if (isGrid) {
      const cols = node.columns || 3;
      settings.grid_columns_grid = {
        unit: 'fr',
        size: cols,
      };
      settings.grid_columns_grid_tablet = {
        unit: 'fr',
        size: Math.min(2, Math.max(1, cols - 1)),
      };
      settings.grid_columns_grid_mobile = {
        unit: 'fr',
        size: 1,
      };
      const gapVal = node.gap ?? lt?.gap_px;
      if (gapVal !== undefined) {
        settings.grid_gap = {
          unit: 'px',
          column: gapVal,
          row: gapVal,
          isLinked: true,
        };
        settings.grid_gap_tablet = {
          unit: 'px',
          column: Math.max(12, Math.round(gapVal * 0.75)),
          row: Math.max(12, Math.round(gapVal * 0.75)),
          isLinked: true,
        };
        settings.grid_gap_mobile = {
          unit: 'px',
          column: Math.max(8, Math.round(gapVal * 0.5)),
          row: Math.max(8, Math.round(gapVal * 0.5)),
          isLinked: true,
        };
      }
      this.inferredResponsiveCount++;
    } else {
      let flexDir = node.direction || (node.styles as any)?.flexDirection || lt?.direction;
      if (!flexDir && Array.isArray(node.children) && node.children.length >= 2) {
        // Detect side-by-side columns: if 2+ children have proportional widths <= 65%
        const proportionalChildren = node.children.filter((c: any) => {
          const w = c.styles?.width || c.layout_tree?.width_pct;
          if (typeof w === 'string' && w.endsWith('%')) {
            const v = parseFloat(w);
            return v > 0 && v <= 65;
          }
          if (typeof w === 'number') {
            return w > 0 && w <= 65;
          }
          return false;
        });
        if (proportionalChildren.length >= 2) {
          flexDir = 'row';
        }
      }
      flexDir = flexDir || 'column';
      settings.flex_direction = flexDir;
      const isHeaderActions =
        node.label === 'header-actions' ||
        (node as any).role === 'header-actions' ||
        node.id?.includes('header_actions') ||
        node.id?.includes('nav_actions');

      if (flexDir === 'row') {
        if (isHeaderActions) {
          settings.flex_direction_tablet = 'row';
          settings.flex_direction_mobile = 'row';
          settings.flex_wrap = 'nowrap';
          settings.flex_justify_content = 'flex-end';
          settings.align_self = 'center';
          settings.flex_grow = 0;
          settings._flex_grow = 0;
          settings.flex_shrink = 0;
          settings._flex_shrink = 0;
          settings.content_width = 'full';
          settings.width = { unit: 'initial', size: '' };
          settings._element_width = 'initial';
        } else {
          settings.flex_direction_tablet = 'column';
          settings.flex_direction_mobile = 'column';
        }
        this.inferredResponsiveCount++;
      }
      const justify = node.justifyContent || (node.styles as any)?.justifyContent || lt?.justify_content || lt?.justifyContent;
      if (justify) settings.flex_justify_content = this.mapJustifyContent(justify);
      const align = node.alignItems || (node.styles as any)?.alignItems || lt?.align_items || lt?.alignItems;
      if (align) settings.flex_align_items = this.mapAlignItems(align);
      const wrap = node.wrap || (node.styles as any)?.flexWrap === 'wrap';
      if (wrap) settings.flex_wrap = 'wrap';
      const gap = node.gap ?? (node.styles as any)?.gap ?? (lt?.gap_px !== undefined ? Number(lt.gap_px) : undefined);
      if (gap !== undefined && !isNaN(gap)) {
        settings.flex_gap = { unit: 'px', size: gap };
        settings.flex_gap_tablet = { unit: 'px', size: Math.max(10, Math.round(gap * 0.75)) };
        settings.flex_gap_mobile = { unit: 'px', size: Math.max(6, Math.round(gap * 0.5)) };
      }
      if ((node.styles as any)?.alignSelf) {
        settings.align_self = this.mapAlignItems((node.styles as any).alignSelf);
      }
      if (lt?.width_pct && !settings.width) {
        settings.width = { unit: '%', size: Number(lt.width_pct) };
      }
    }

    this.applyStylesToSettings(node.styles, settings, true);

    if (node.responsiveOverrides) {
      this.applyResponsiveOverrides(node.responsiveOverrides, settings, true);
      this.explicitResponsiveCount++;
    }

    const isHeaderActionsContainer =
      node.label === 'header-actions' ||
      (node as any).role === 'header-actions' ||
      node.id?.includes('header_actions') ||
      node.id?.includes('nav_actions');

    const elements: ElementorElement[] = [];
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const el = this.convertNode(child, dir);
        if (el) {
          if (isHeaderActionsContainer) {
            el.settings = el.settings || {};
            el.settings._element_width = 'initial';
            el.settings._flex_grow = 0;
            el.settings._flex_shrink = 0;
            el.settings.align_self = 'center';
          }
          elements.push(el);
        }
      }
    }

    return {
      id: this.nextId(),
      elType: 'container',
      settings,
      elements,
    };
  }

  private convertHeadingNode(node: DIRHeadingNode, dir?: DIRDocument): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('heading');

    const typo = (node as any).typography;
    let titleText = (node as any).html || node.text || '';
    const accentWord = (node as any).accentWord || (node as any).accent?.text || (node as any).accent_word;
    const accentColor =
      (node as any).accentColor ||
      (node as any).accent?.color ||
      dir?.globals?.colors?.primary ||
      dir?.globals?.colors?.accent ||
      '#FF4625';

    if (accentWord && titleText.includes(accentWord)) {
      const replacement = `<span style="position:relative;display:inline-block;">${accentWord}<svg style="position:absolute;left:0;bottom:-6px;width:100%;height:12px;overflow:visible;" viewBox="0 0 100 12" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><path d="M2 7C28 2 70 2 98 8C72 5 30 5 2 9" stroke="${accentColor}" stroke-width="4.5" stroke-linecap="round"/></svg></span>`;
      titleText = titleText.replace(accentWord, replacement);
    }

    const settings: Record<string, any> = {
      title: titleText,
      header_size: `h${node.level || 2}`,
    };

    const align = node.styles?.textAlign || typo?.text_align || typo?.textAlign;
    if (align) {
      settings.align = align;
    }
    if (node.label === 'logo' || node.id?.toLowerCase().includes('logo')) {
      settings.align = settings.align || 'left';
      settings.align_self = 'center';
    }
    const color = node.styles?.color || typo?.color_hex || typo?.color;
    if (color) {
      settings.title_color = color;
    } else {
      const effBg = getEffectiveBackgroundColor(node.styles, dir);
      const isDarkBg = isDarkColor(effBg);
      const globalText = dir?.globals?.colors?.text;
      const globalTextIsBright = globalText && !isDarkColor(globalText);
      const globalTextIsDark = globalText && isDarkColor(globalText);
      if (isDarkBg) {
        settings.title_color = globalTextIsBright ? globalText : '#ffffff';
      } else {
        settings.title_color = globalTextIsDark ? globalText : (globalText || '#182135');
      }
    }

    this.applyTypographyStyles(node.styles, settings, typo, 'heading', dir);

    if (node.responsiveOverrides) {
      this.applyResponsiveOverrides(node.responsiveOverrides, settings, false);
      this.explicitResponsiveCount++;
    }

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'heading',
      settings,
      elements: [],
    };
  }

  private convertTextNode(node: DIRTextNode, dir?: DIRDocument): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('text-editor');

    const typo = (node as any).typography;
    const settings: Record<string, any> = {
      editor: node.html || node.text || '<p></p>',
    };

    const align = node.styles?.textAlign || typo?.text_align || typo?.textAlign;
    if (align) {
      settings.align = align;
    }
    const color = node.styles?.color || typo?.color_hex || typo?.color;
    if (color) {
      settings.text_color = color;
    } else {
      const effBg = getEffectiveBackgroundColor(node.styles, dir);
      const isDarkBg = isDarkColor(effBg);
      const globalText = dir?.globals?.colors?.text;
      const globalTextIsBright = globalText && !isDarkColor(globalText);
      const globalTextIsDark = globalText && isDarkColor(globalText);
      if (isDarkBg) {
        settings.text_color = globalTextIsBright ? globalText : '#e2e8f0';
      } else {
        settings.text_color = globalTextIsDark ? globalText : (globalText || '#475569');
      }
    }

    this.applyTypographyStyles(node.styles, settings, typo, 'body', dir);

    if (node.responsiveOverrides) {
      this.applyResponsiveOverrides(node.responsiveOverrides, settings, false);
      this.explicitResponsiveCount++;
    }

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'text-editor',
      settings,
      elements: [],
    };
  }

  private convertButtonNode(node: DIRButtonNode, dir?: DIRDocument): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('button');

    const typo = (node as any).typography;
    const settings: Record<string, any> = {
      text: node.text || 'Click here',
      link: { url: node.url || '#', is_external: '', nofollow: '' },
      size: node.size === 'large' ? 'lg' : node.size === 'small' ? 'sm' : 'md',
    };

    const rawBtnGrad = (node.styles as any)?.backgroundGradient;
    const btnBg = node.styles?.backgroundColor || dir?.globals?.colors?.primary || dir?.globals?.colors?.accent;

    if (rawBtnGrad) {
      let startColor = btnBg || '#deb285';
      let endColor = '#deb285';
      let angle = 90;
      if (typeof rawBtnGrad === 'object' && rawBtnGrad !== null) {
        startColor = rawBtnGrad.startColor || startColor;
        endColor = rawBtnGrad.endColor || endColor;
        angle = rawBtnGrad.angle ?? angle;
      } else if (typeof rawBtnGrad === 'string') {
        const hexMatches = rawBtnGrad.match(/#[0-9a-fA-F]{3,8}/g);
        if (hexMatches && hexMatches.length >= 2) {
          startColor = hexMatches[0];
          endColor = hexMatches[1];
        }
      }
      settings.background_background = 'gradient';
      settings.background_color = startColor;
      settings.background_color_b = endColor;
      settings.background_gradient_angle = { unit: 'deg', size: angle };
    } else if (btnBg) {
      settings.background_color = btnBg;
    }

    if ((node as any).variant === 'outline' && !node.styles?.backgroundColor && !rawBtnGrad) {
      settings.background_color = 'transparent';
    }
    const color = node.styles?.color || typo?.color_hex || typo?.color;
    if (color) {
      settings.button_text_color = color;
    } else if (settings.background_color) {
      settings.button_text_color = isDarkColor(settings.background_color) ? '#ffffff' : '#060b05';
    } else {
      settings.button_text_color = '#ffffff';
    }
    if (node.styles?.borderRadius !== undefined) {
      settings.border_radius = this.mapBorderRadius(node.styles.borderRadius);
    } else {
      const isPill = node.text?.toLowerCase().includes('get started') || (node as any).variant === 'pill';
      const defaultRadius = isPill ? 50 : 8;
      settings.border_radius = {
        unit: 'px',
        top: String(defaultRadius),
        right: String(defaultRadius),
        bottom: String(defaultRadius),
        left: String(defaultRadius),
        isLinked: true,
      };
    }
    if (node.styles?.borderWidth || (node as any).variant === 'outline') {
      settings.border_border = node.styles?.borderStyle || 'solid';
      const bWidth = String(node.styles?.borderWidth || 1);
      settings.border_width = {
        unit: 'px',
        top: bWidth,
        right: bWidth,
        bottom: bWidth,
        left: bWidth,
        isLinked: true,
      };
      if (node.styles?.borderColor) {
        settings.border_color = node.styles.borderColor;
      }
    }
    if (node.styles?.padding) {
      settings.button_padding = this.mapSpacing(node.styles.padding);
      settings.button_padding_tablet = this.mapScaledSpacing(node.styles.padding, 0.8, 0.75);
      settings.button_padding_mobile = this.mapScaledSpacing(node.styles.padding, 0.65, 0.6, 10);
      this.inferredResponsiveCount++;
    }
    const align = node.styles?.textAlign || typo?.text_align || typo?.textAlign;
    if (align) {
      settings.align = align;
    }
    settings.align_self = 'center';
    settings._element_width = 'initial';
    settings._flex_grow = 0;
    settings._flex_shrink = 0;

    this.applyTypographyStyles(node.styles, settings, typo, 'button', dir);

    if (node.responsiveOverrides) {
      this.applyResponsiveOverrides(node.responsiveOverrides, settings, false);
      this.explicitResponsiveCount++;
    }

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'button',
      settings,
      elements: [],
    };
  }

  private convertImageNode(node: DIRImageNode, dir: DIRDocument): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('image');

    let imageUrl = (node as any).url || (node as any).imageUrl || '';
    let imagePath = (node as any).path || '';
    if (node.assetId) {
      const asset = dir.assets?.find((a) => a.id === node.assetId);
      if (asset) {
        if (!imageUrl) imageUrl = asset.placeholder || (asset as any).url || '';
        if (!imagePath && asset.path) imagePath = asset.path;
      }
    }

    if (!imageUrl || !String(imageUrl).trim()) throw new Error(`Image node '${node.id}' has no resolved asset URL`);

    const imageObj: Record<string, any> = {
      url: imageUrl || '',
      id: '',
    };
    if (imagePath) {
      imageObj.path = imagePath;
    }

    const settings: Record<string, any> = {
      image: imageObj,
      image_size: 'full',
      align: 'center',
    };

    if (node.alt) {
      settings.caption = node.alt;
      settings.alt_text = node.alt;
    }
    const isLogo = node.label === 'logo' ||
      node.id?.toLowerCase().includes('logo') ||
      (node as any).assetId?.toLowerCase().includes('logo') ||
      (node.alt && node.alt.toLowerCase().includes('logo'));

    if (isLogo) { settings['object-fit'] = 'contain'; settings.align = 'left'; settings.align_self = 'center'; settings._flex_grow = 0; settings._flex_shrink = 0; }
    if (node.styles?.width !== undefined) settings.width = this.dimension(node.styles.width);
    if (node.styles?.borderRadius !== undefined) {
      settings.border_radius = this.mapBorderRadius(node.styles.borderRadius);
    }
    if (node.styles?.height !== undefined) settings.height = this.dimension(node.styles.height);
    if ((node as any).composite_graphic_asset) {
      settings['object-fit'] = 'contain';
    } else if ((node as any).objectFit) {
      settings['object-fit'] = (node as any).objectFit;
    }

    if (node.responsiveOverrides) {
      this.applyResponsiveOverrides(node.responsiveOverrides, settings, false);
      this.explicitResponsiveCount++;
    }

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'image',
      settings,
      elements: [],
    };
  }

  private convertIconNode(node: DIRIconNode): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('icon');

    let iconValue = 'fas fa-star';
    if (node.iconName) {
      const iconMap: Record<string, string> = {
        'sun-spokes': 'fas fa-bahai',
        'sun': 'fas fa-sun',
        'mouse': 'fas fa-mouse',
        'scroll': 'fas fa-mouse',
      };
      iconValue = iconMap[node.iconName] || `fas fa-${node.iconName}`;
    }

    const settings: Record<string, any> = {
      selected_icon: {
        value: iconValue,
        library: node.iconLibrary || 'fa-solid',
      },
      view: 'default',
    };

    if (node.styles?.color) settings.primary_color = node.styles.color;
    if (node.styles?.fontSize) settings.size = { unit: 'px', size: node.styles.fontSize };

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'icon',
      settings,
      elements: [],
    };
  }

  private convertIconBoxNode(node: DIRIconTextNode, dir?: DIRDocument): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('icon-box');

    const settings: Record<string, any> = {
      selected_icon: {
        value: node.iconName ? `fas fa-${node.iconName}` : 'fas fa-star',
        library: 'fa-solid',
      },
      title_text: node.title || 'Feature',
      description_text: node.text || '',
      position: 'top',
    };

    const effBg = getEffectiveBackgroundColor(node.styles, dir);
    const titleColor = node.styles?.color || (isDarkColor(effBg) ? '#ffffff' : (dir?.globals?.colors?.text || '#182135'));
    settings.title_color = titleColor;

    const boxFont = canonicalizeFontFamily(node.styles?.fontFamily || dir?.globals?.typography?.headingFont);
    if (boxFont) {
      settings.title_typography_typography = 'custom';
      settings.title_typography_font_family = boxFont;
    }

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'icon-box',
      settings,
      elements: [],
    };
  }

  private convertListNode(node: DIRListNode): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('icon-list');

    const items = (node.children || []).map((item) => ({
      _id: this.nextId().slice(0, 7),
      text: item.text || 'List item',
      selected_icon: {
        value: item.icon ? `fas fa-${item.icon}` : 'fas fa-check',
        library: 'fa-solid',
      },
      link: { url: (item as any).url || '', is_external: '', nofollow: '' },
    }));

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'icon-list',
      settings: {
        view: 'traditional',
        icon_list: items,
      },
      elements: [],
    };
  }

  private convertDividerNode(node: DIRDividerNode): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('divider');

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'divider',
      settings: {
        style: 'solid',
        weight: { unit: 'px', size: node.thickness || 1 },
        color: node.styles?.borderColor || '#E5E7EB',
      },
      elements: [],
    };
  }

  private convertSpacerNode(node: DIRSpacerNode): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('spacer');

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'spacer',
      settings: {
        space: { unit: 'px', size: node.height || 50 },
      },
      elements: [],
    };
  }

  private convertCounterNode(node: DIRCounterNode, dir?: DIRDocument): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('counter');

    let endingNumber = node.value || 100;
    let suffix = node.suffix || '';
    if (endingNumber >= 1000 && endingNumber % 1000 === 0 && !suffix) {
      endingNumber = endingNumber / 1000;
      suffix = 'k';
    }

    const settings: Record<string, any> = {
      starting_number: 0,
      ending_number: endingNumber,
      prefix: node.prefix || '',
      suffix: suffix,
      title: node.title || '',
    };

    const effBg = getEffectiveBackgroundColor(node.styles, dir);
    const counterColor = node.styles?.color || (isDarkColor(effBg) ? '#ffffff' : (dir?.globals?.colors?.text || '#182135'));
    settings.number_color = counterColor;
    settings.title_color = counterColor;

    const counterFont = canonicalizeFontFamily(node.styles?.fontFamily || dir?.globals?.typography?.headingFont);
    if (counterFont) {
      settings.typography_number_typography = 'custom';
      settings.typography_number_font_family = counterFont;
      settings.typography_title_typography = 'custom';
      settings.typography_title_font_family = counterFont;
    }

    if (node.styles?.fontSize) {
      settings.typography_number_typography = 'custom';
      settings.typography_number_font_size = { unit: 'px', size: node.styles.fontSize };
      if (node.styles.fontSize >= 28) {
        settings.typography_number_font_size_tablet = { unit: 'px', size: Math.round(node.styles.fontSize * 0.85) };
        settings.typography_number_font_size_mobile = { unit: 'px', size: Math.max(20, Math.round(node.styles.fontSize * 0.7)) };
        this.inferredResponsiveCount++;
      }
    }

    if (node.styles?.fontWeight) {
      settings.typography_number_typography = 'custom';
      settings.typography_number_font_weight = String(node.styles.fontWeight);
    }

    if (node.styles?.textAlign) {
      settings.align = node.styles.textAlign;
    } else {
      settings.align = 'center';
    }

    if (node.responsiveOverrides) {
      this.applyResponsiveOverrides(node.responsiveOverrides, settings, false);
      this.explicitResponsiveCount++;
    }

    const counterElement: ElementorElement = {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'counter',
      settings,
      elements: [],
    };

    const isCircular =
      (node.styles?.borderRadius as any) === 9999 ||
      (node.styles?.borderRadius as any) === '50%' ||
      (typeof node.styles?.borderRadius === 'number' && node.styles.borderRadius >= 50);

    if (isCircular && node.styles?.backgroundColor) {
      const circleSize = 110;
      settings.duration = 0;
      settings.align = 'center';
      if (!settings.typography_number_font_size) {
        settings.typography_number_typography = 'custom';
        settings.typography_number_font_size = { unit: 'px', size: 34 };
      }
      return {
        id: this.nextId(),
        elType: 'container',
        settings: {
          container_type: 'flex',
          content_width: 'full',
          width: { unit: 'px', size: circleSize },
          width_tablet: { unit: 'px', size: Math.max(80, circleSize - 10) },
          width_mobile: { unit: 'px', size: Math.max(70, circleSize - 20) },
          min_height: { unit: 'px', size: circleSize },
          min_height_tablet: { unit: 'px', size: Math.max(80, circleSize - 10) },
          min_height_mobile: { unit: 'px', size: Math.max(70, circleSize - 20) },
          height: 'min-height',
          custom_height: { unit: 'px', size: circleSize },
          border_radius: { unit: '%', top: '50', right: '50', bottom: '50', left: '50', isLinked: true },
          background_background: 'classic',
          background_color: node.styles.backgroundColor,
          flex_justify_content: 'center',
          flex_align_items: 'center',
          flex_align_self: 'center',
          align_self: 'center',
          flex_grow: 0,
          flex_shrink: 0,
          flex_direction: 'column',
          padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true },
        },
        elements: [counterElement],
      };
    }

    return counterElement;
  }

  private convertProgressNode(node: DIRProgressBarNode): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('progress');

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'progress',
      settings: {
        title: node.label || '',
        percent: { unit: '%', size: node.value || 50 },
        display_percentage: 'show',
      },
      elements: [],
    };
  }

  private convertSocialIconsNode(node: DIRSocialIconsNode): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('social-icons');

    const iconList = (node.platforms || []).map((p) => ({
      _id: this.nextId().slice(0, 7),
      social_icon: {
        value: `fab fa-${p.name.toLowerCase()}`,
        library: 'fa-brands',
      },
      link: { url: p.url || '#', is_external: '', nofollow: '' },
    }));

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'social-icons',
      settings: {
        social_icon_list: iconList,
        shape: 'rounded',
        align: 'center',
      },
      elements: [],
    };
  }

  private extractChildContent(children: any[]): string {
    if (!children || !Array.isArray(children) || children.length === 0) return '<p>Content</p>';
    const htmlParts: string[] = [];
    for (const c of children) {
      if (c.kind === 'text') {
        htmlParts.push(c.html || `<p>${c.text || ''}</p>`);
      } else if (c.kind === 'heading') {
        htmlParts.push(`<h${c.level || 3}>${c.text || ''}</h${c.level || 3}>`);
      } else if (c.text) {
        htmlParts.push(`<p>${c.text}</p>`);
      }
    }
    return htmlParts.length > 0 ? htmlParts.join('\n') : '<p>Content</p>';
  }

  private convertTabsNode(node: DIRTabsNode, dir: DIRDocument): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('tabs');

    const tabList = (node.tabs || []).map((t) => ({
      _id: this.nextId().slice(0, 7),
      tab_title: t.title || 'Tab',
      tab_content: this.extractChildContent(t.children),
    }));

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'tabs',
      settings: {
        tabs: tabList,
      },
      elements: [],
    };
  }

  private convertAccordionNode(node: DIRAccordionNode, dir: DIRDocument): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('accordion');

    const tabList = (node.items || []).map((item) => ({
      _id: this.nextId().slice(0, 7),
      tab_title: item.title || 'Accordion Item',
      tab_content: this.extractChildContent(item.children),
    }));

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'accordion',
      settings: {
        tabs: tabList,
      },
      elements: [],
    };
  }

  private convertMapNode(node: any): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('google_maps');

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'google_maps',
      settings: {
        address: node.address || 'London Eye, London, United Kingdom',
        zoom: { unit: 'px', size: node.zoom || 14 },
        height: { unit: 'px', size: node.height || 300 },
      },
      elements: [],
    };
  }

  private convertVideoNode(node: any): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('video');

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'video',
      settings: {
        video_type: node.videoType || 'youtube',
        youtube_url: node.url || 'https://www.youtube.com/watch?v=XHTrLYShBRQ',
      },
      elements: [],
    };
  }

  private convertRatingNode(node: any): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('star-rating');

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'star-rating',
      settings: {
        rating_scale: '5',
        rating: node.value || 5,
        star_style: 'star_fontawesome',
      },
      elements: [],
    };
  }

  private convertLinkAsButton(node: any, dir?: DIRDocument): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('button');

    const typo = (node as any).typography;
    const effBg = getEffectiveBackgroundColor(node.styles, dir);
    const defaultColor = isDarkColor(effBg) ? '#ffffff' : (dir?.globals?.colors?.text || '#182135');
    const color = node.styles?.color || typo?.color_hex || defaultColor;

    const settings: Record<string, any> = {
      text: node.text || 'Link',
      link: { url: node.url || '#', is_external: '', nofollow: '' },
      button_type: 'default',
      background_color: 'transparent',
      button_text_color: color,
      button_padding: { top: '0', right: '0', bottom: '0', left: '0', unit: 'px', isLinked: true },
    };

    this.applyTypographyStyles(node.styles, settings, typo, 'button', dir);
    if (!settings.typography_font_size) {
      settings.typography_font_size = { unit: 'px', size: 14 };
      settings.typography_typography = 'custom';
    }

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'button',
      settings,
      elements: [],
    };
  }

  private convertBadgeAsHeading(node: any, dir?: DIRDocument): ElementorElement {
    this.widgetCount++;
    this.elementCount += 2;
    this.widgetsUsed.add('heading');

    const bgColor = node.styles?.backgroundColor || dir?.globals?.colors?.accent || dir?.globals?.colors?.primary || '#b7f34c';
    const textColor = node.styles?.color || (isDarkColor(bgColor) ? '#ffffff' : '#060b05');
    const fontSize = node.styles?.fontSize || 13;
    const padding = node.styles?.padding || { top: 6, bottom: 6, left: 16, right: 16 };
    const borderRadius = node.styles?.borderRadius || 9999;

    const badgeFont = canonicalizeFontFamily(dir?.globals?.typography?.bodyFont || dir?.globals?.typography?.headingFont || 'Plus Jakarta Sans');

    return {
      id: this.nextId(),
      elType: 'container',
      settings: {
        container_type: 'flex',
        flex_direction: 'row',
        content_width: 'boxed',
        align_self: 'center',
        flex_align_items: 'center',
        flex_justify_content: 'center',
        background_background: 'classic',
        background_color: bgColor,
        border_radius: this.mapBorderRadius(borderRadius),
        padding: this.mapSpacing(padding),
      },
      elements: [
        {
          id: this.nextId(),
          elType: 'widget',
          widgetType: 'heading',
          settings: {
            title: node.text || '',
            header_size: 'span',
            title_color: textColor,
            align: 'center',
            typography_typography: 'custom',
            typography_font_family: badgeFont,
            typography_font_size: { unit: 'px', size: fontSize },
            typography_font_weight: '600',
          },
          elements: [],
        },
      ],
    };
  }

  private convertInputNode(node: any, dir?: DIRDocument): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('html');

    const formDetails = node.form_details;
    const placeholder = formDetails?.placeholder || node.placeholder || 'Enter your email...';
    const effBg = getEffectiveBackgroundColor(node.styles, dir);
    const isDark = isDarkColor(effBg);

    const defaultBg = isDark ? 'rgba(255, 255, 255, 0.08)' : '#ffffff';
    const defaultColor = isDark ? '#f8fafc' : '#1e293b';
    const defaultBorder = isDark ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid #cbd5e1';

    const bg = formDetails?.background_hex || node.styles?.backgroundColor || defaultBg;
    const color = node.styles?.color || defaultColor;

    let borderRadius = 50;
    if (formDetails?.border_radius_px !== undefined) {
      borderRadius = formDetails.border_radius_px;
    } else if (typeof node.styles?.borderRadius === 'number') {
      borderRadius = node.styles.borderRadius;
    } else if (node.styles?.borderRadius && typeof node.styles.borderRadius === 'object') {
      borderRadius = node.styles.borderRadius.topLeft || node.styles.borderRadius.topRight || 50;
    }

    const fontSize = node.styles?.fontSize || 14;

    const html = `<div class="elementor-custom-input-wrap" style="width: 100%;">
  <input type="email" placeholder="${placeholder}" style="width: 100%; background: ${bg}; color: ${color}; border: ${defaultBorder}; border-radius: ${borderRadius}px; padding: 14px 22px; font-size: ${fontSize}px; outline: none; box-sizing: border-box;" />
</div>`;

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'html',
      settings: {
        html,
      },
      elements: [],
    };
  }

  private convertImageBoxNode(node: any, dir?: DIRDocument): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('image-box');

    let imageUrl = (node as any).url || (node as any).imageUrl || '';
    let imagePath = (node as any).path || '';
    if (node.assetId && dir?.assets) {
      const asset = dir.assets.find((a) => a.id === node.assetId);
      if (asset) {
        if (!imageUrl) imageUrl = asset.placeholder || (asset as any).url || '';
        if (!imagePath && asset.path) imagePath = asset.path;
      }
    }

    const imageObj: Record<string, any> = {
      url: imageUrl,
      id: '',
    };
    if (imagePath) {
      imageObj.path = imagePath;
    }

    const settings: Record<string, any> = {
      image: imageObj,
      title_text: node.title || node.text || '',
      description_text: node.description || '',
      title_size: 'h3',
      position: node.imagePosition || 'top',
    };

    if (node.link) {
      settings.link = { url: node.link, is_external: '', nofollow: '' };
    }
    if (node.styles?.color) settings.title_color = node.styles.color;

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'image-box',
      settings,
      elements: [],
    };
  }

  private convertTestimonialNode(node: any, dir?: DIRDocument): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('testimonial');

    let imageUrl = (node as any).imageUrl || (node as any).url || '';
    let imagePath = (node as any).path || '';
    if (node.assetId && dir?.assets) {
      const asset = dir.assets.find((a) => a.id === node.assetId);
      if (asset) {
        if (!imageUrl) imageUrl = asset.placeholder || (asset as any).url || '';
        if (!imagePath && asset.path) imagePath = asset.path;
      }
    }

    const imageObj: Record<string, any> = {
      url: imageUrl,
      id: '',
    };
    if (imagePath) {
      imageObj.path = imagePath;
    }

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'testimonial',
      settings: {
        testimonial_content: node.content || node.text || '',
        testimonial_name: node.name || node.author || '',
        testimonial_job: node.job || node.role || '',
        testimonial_image: imageObj,
        testimonial_alignment: node.styles?.textAlign || 'center',
        image_size: 'thumbnail',
      },
      elements: [],
    };
  }

  private convertToggleNode(node: any, dir: DIRDocument): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('toggle');

    const tabList = (node.items || node.children || []).map((item: any) => ({
      _id: this.nextId().slice(0, 7),
      tab_title: item.title || 'Item',
      tab_content: this.extractChildContent(Array.isArray(item.children) ? item.children : [item]),
    }));

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'toggle',
      settings: {
        tabs: tabList,
        title_html_tag: 'div',
      },
      elements: [],
    };
  }

  private convertGalleryNode(node: any, dir?: DIRDocument): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('image-gallery');

    const gallery = (node.images || node.children || []).map((img: any) => {
      let url = img.url || img.imageUrl || '';
      let path = img.path || '';
      if (img.assetId && dir?.assets) {
        const asset = dir.assets.find((a) => a.id === img.assetId);
        if (asset) {
          if (!url) url = asset.placeholder || (asset as any).url || '';
          if (!path && asset.path) path = asset.path;
        }
      }
      const item: Record<string, any> = {
        url,
        id: '',
      };
      if (path) item.path = path;
      return item;
    });

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'image-gallery',
      settings: {
        wp_gallery: gallery,
        gallery_columns: String(node.columns || '3'),
        thumbnail_size: 'medium',
        gallery_display_caption: 'none',
        gallery_link: 'none',
        open_lightbox: 'no',
      },
      elements: [],
    };
  }

  private convertFallbackNode(node: any): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('text-editor');

    return {
      id: this.nextId(),
      elType: 'widget',
      widgetType: 'text-editor',
      settings: {
        editor: `<div class="fallback-node" data-kind="${node.kind}">${node.label || node.kind}</div>`,
      },
      elements: [],
    };
  }

  private applyStylesToSettings(styles: DIRStyles | undefined, settings: Record<string, any>, isContainer: boolean): void {
    if (!styles) return;

    const rawGrad = (styles as any)?.backgroundGradient;
    if (rawGrad && isContainer) {
      let startColor = styles.backgroundColor || '#1b2248';
      let endColor = '#141b3c';
      let angle = 180;

      if (typeof rawGrad === 'object' && rawGrad !== null) {
        startColor = rawGrad.startColor || startColor;
        endColor = rawGrad.endColor || endColor;
        angle = rawGrad.angle ?? angle;
      } else if (typeof rawGrad === 'string') {
        const hexMatches = rawGrad.match(/#[0-9a-fA-F]{3,8}/g);
        if (hexMatches && hexMatches.length >= 2) {
          startColor = hexMatches[0];
          endColor = hexMatches[1];
        }
      }

      settings.background_background = 'gradient';
      settings.background_color = startColor;
      settings.background_color_b = endColor;
      settings.background_gradient_type = 'linear';
      settings.background_gradient_angle = { unit: 'deg', size: angle };
      settings.background_color_stop = { unit: '%', size: 0 };
      settings.background_color_b_stop = { unit: '%', size: 100 };
    } else if (styles.backgroundColor) {
      if (isContainer) {
        settings.background_background = 'classic';
        settings.background_color = styles.backgroundColor;
      } else {
        settings.background_color = styles.backgroundColor;
      }
    }

    if (styles.padding) {
      settings.padding = this.mapSpacing(styles.padding);
      settings.padding_tablet = this.mapScaledSpacing(styles.padding, 0.75, 0.7);
      settings.padding_mobile = this.mapScaledSpacing(styles.padding, 0.5, 0.4, 12);
      this.inferredResponsiveCount++;
    }
    if (styles.margin) {
      settings.margin = this.mapSpacing(styles.margin);
      settings.margin_tablet = this.mapScaledSpacing(styles.margin, 0.75, 0.7);
      settings.margin_mobile = this.mapScaledSpacing(styles.margin, 0.5, 0.4);
      this.inferredResponsiveCount++;
    }

    if (styles.borderRadius !== undefined) {
      settings.border_radius = this.mapBorderRadius(styles.borderRadius);
    }

    if (styles.borderWidth) {
      settings.border_border = styles.borderStyle || 'solid';
      settings.border_width = {
        unit: 'px',
        top: String(styles.borderWidth),
        right: String(styles.borderWidth),
        bottom: String(styles.borderWidth),
        left: String(styles.borderWidth),
        isLinked: true,
      };
      if (styles.borderColor) {
        settings.border_color = styles.borderColor;
      }
    }

    if (styles.boxShadow) {
      settings.box_shadow_box_shadow_type = 'yes';
    }

    if (styles.width !== undefined) {
      settings.width = this.dimension(styles.width);
      if (isContainer && settings.width.unit === '%' && settings.width.size === 100) settings.content_width = 'full';
    }
    if (styles.maxWidth !== undefined && isContainer) {
      settings.content_width = 'boxed';
      settings.boxed_width = { ...this.dimension(styles.maxWidth), sizes: [] };
    }
    const minHeight = styles.minHeight ?? (isContainer ? styles.height : undefined);
    if (minHeight !== undefined) { settings.min_height = { ...this.dimension(minHeight), sizes: [] }; }
    if (isContainer) {
      if (styles.flexDirection) settings.flex_direction = styles.flexDirection;
      if (styles.justifyContent) settings.flex_justify_content = this.mapJustifyContent(styles.justifyContent);
      if (styles.alignItems) settings.flex_align_items = this.mapAlignItems(styles.alignItems);
      if (styles.flexWrap) settings.flex_wrap = styles.flexWrap;
      if (styles.gap !== undefined) settings.flex_gap = { unit: 'px', size: styles.gap };
      if (styles.gridColumns !== undefined) settings.grid_columns_grid = { unit: 'fr', size: styles.gridColumns };
    }

    if (styles.backgroundImage && isContainer) {
      settings.background_background = 'classic';
      const bgImageObj: Record<string, any> = {
        url: styles.backgroundImage,
        id: (styles as any).backgroundImageAssetId || '',
      };
      if ((styles as any).backgroundImagePath) {
        bgImageObj.path = (styles as any).backgroundImagePath;
      }
      settings.background_image = bgImageObj;
      if (styles.backgroundPosition) settings.background_position = styles.backgroundPosition;
      if (styles.backgroundSize) settings.background_size = styles.backgroundSize;
      settings.background_repeat = 'no-repeat';
    }
  }

  private applyTypographyStyles(
    styles: DIRStyles | undefined,
    settings: Record<string, any>,
    typography?: Record<string, any>,
    fallbackKind?: 'heading' | 'body' | 'button',
    dir?: DIRDocument
  ): void {
    const rawFont = styles?.fontFamily || typography?.font_family_guess || typography?.font_family;
    const globalFont = fallbackKind === 'heading'
      ? dir?.globals?.typography?.headingFont
      : (fallbackKind === 'body' || fallbackKind === 'button'
          ? dir?.globals?.typography?.bodyFont
          : undefined);
    const anyGlobalFont = dir?.globals?.typography?.fontFamilies?.[0] || dir?.globals?.typography?.headingFont || dir?.globals?.typography?.bodyFont;

    const candidateFont = rawFont || globalFont || anyGlobalFont || (fallbackKind === 'heading' ? 'Plus Jakarta Sans' : 'Inter');
    const canonicalFont = canonicalizeFontFamily(candidateFont);
    const rawFontSize = styles?.fontSize ?? (typography?.font_size_px !== undefined ? Number(typography.font_size_px) : undefined);
    const fontSize = typeof rawFontSize === 'number' && !isNaN(rawFontSize) ? rawFontSize : undefined;
    const rawFontWeight = styles?.fontWeight ?? typography?.font_weight;
    const fontWeight = rawFontWeight !== undefined ? String(rawFontWeight) : undefined;
    const rawLineHeight = styles?.lineHeight ?? typography?.line_height_em ?? typography?.line_height;
    const lineHeight = rawLineHeight !== undefined ? (typeof rawLineHeight === 'number' ? rawLineHeight : parseFloat(String(rawLineHeight))) : undefined;
    const rawLetterSpacing = styles?.letterSpacing ?? (typography?.letter_spacing_px !== undefined ? Number(typography.letter_spacing_px) : undefined);
    const letterSpacing = typeof rawLetterSpacing === 'number' && !isNaN(rawLetterSpacing) ? rawLetterSpacing : undefined;
    const textTransform = styles?.textTransform || typography?.text_transform;
    const textDecoration = styles?.textDecoration || typography?.text_decoration;

    let hasTypo = false;
    if (canonicalFont) {
      settings.typography_font_family = canonicalFont;
      hasTypo = true;
    }
    if (fontSize !== undefined) {
      settings.typography_font_size = { unit: 'px', size: fontSize };
      hasTypo = true;
      if (fontSize >= 44) {
        settings.typography_font_size_tablet = { unit: 'px', size: Math.round(fontSize * 0.8) };
        settings.typography_font_size_mobile = { unit: 'px', size: Math.max(24, Math.round(fontSize * 0.6)) };
        this.inferredResponsiveCount++;
      } else if (fontSize >= 28) {
        settings.typography_font_size_tablet = { unit: 'px', size: Math.round(fontSize * 0.85) };
        settings.typography_font_size_mobile = { unit: 'px', size: Math.max(20, Math.round(fontSize * 0.72)) };
        this.inferredResponsiveCount++;
      } else if (fontSize >= 18) {
        settings.typography_font_size_mobile = { unit: 'px', size: Math.max(15, Math.round(fontSize * 0.88)) };
        this.inferredResponsiveCount++;
      }
    }
    if (fontWeight !== undefined) {
      settings.typography_font_weight = fontWeight;
      hasTypo = true;
    }
    if (lineHeight !== undefined && !isNaN(lineHeight)) {
      settings.typography_line_height = { unit: 'em', size: lineHeight };
      settings.typography_line_height_tablet = { unit: 'em', size: Math.max(1.2, Math.round(lineHeight * 0.95 * 10) / 10) };
      settings.typography_line_height_mobile = { unit: 'em', size: Math.max(1.2, Math.round(lineHeight * 0.9 * 10) / 10) };
      hasTypo = true;
    }
    if (letterSpacing !== undefined) {
      settings.typography_letter_spacing = { unit: 'px', size: letterSpacing };
      hasTypo = true;
    }
    if (textTransform) {
      settings.typography_text_transform = textTransform;
      hasTypo = true;
    }
    if (textDecoration) {
      settings.typography_text_decoration = textDecoration;
      hasTypo = true;
    }

    if (hasTypo) {
      settings.typography_typography = 'custom';
    }
  }

  private mapScaledSpacing(
    spacing: DIRSpacing,
    scaleVertical: number,
    scaleHorizontal: number,
    minHorizontal?: number
  ): Record<string, any> {
    const top = Math.round((spacing.top ?? 0) * scaleVertical);
    const bottom = Math.round((spacing.bottom ?? 0) * scaleVertical);
    const rawLeft = Math.round((spacing.left ?? 0) * scaleHorizontal);
    const rawRight = Math.round((spacing.right ?? 0) * scaleHorizontal);
    const left = minHorizontal && (spacing.left ?? 0) > 0 ? Math.max(minHorizontal, rawLeft) : rawLeft;
    const right = minHorizontal && (spacing.right ?? 0) > 0 ? Math.max(minHorizontal, rawRight) : rawRight;

    return {
      unit: 'px',
      top: String(top),
      right: String(right),
      bottom: String(bottom),
      left: String(left),
      isLinked: false,
    };
  }

  private applyResponsiveOverrides(
    overrides: Partial<Record<'tablet' | 'mobile', Partial<DIRStyles>>>,
    settings: Record<string, any>,
    _isContainer: boolean
  ): void {
    if (!overrides) return;
    for (const device of ['tablet', 'mobile'] as const) {
      const devStyles = overrides[device];
      if (!devStyles) continue;
      const suffix = `_${device}`;

      if (devStyles.flexDirection) {
        settings[`flex_direction${suffix}`] = devStyles.flexDirection;
      }
      if (devStyles.justifyContent) {
        settings[`flex_justify_content${suffix}`] = this.mapJustifyContent(devStyles.justifyContent);
      }
      if (devStyles.alignItems) {
        settings[`flex_align_items${suffix}`] = this.mapAlignItems(devStyles.alignItems);
      }
      if (devStyles.gap !== undefined) {
        settings[`flex_gap${suffix}`] = { unit: 'px', size: devStyles.gap };
      }
      if (devStyles.padding) {
        settings[`padding${suffix}`] = this.mapSpacing(devStyles.padding);
      }
      if (devStyles.margin) {
        settings[`margin${suffix}`] = this.mapSpacing(devStyles.margin);
      }
      if (devStyles.fontSize) {
        settings[`typography_font_size${suffix}`] = { unit: 'px', size: devStyles.fontSize };
        settings.typography_typography = 'custom';
      }
      if (devStyles.lineHeight) {
        settings[`typography_line_height${suffix}`] = typeof devStyles.lineHeight === 'number'
          ? { unit: 'em', size: devStyles.lineHeight }
          : { unit: 'em', size: 1.5 };
        settings.typography_typography = 'custom';
      }
      if (devStyles.textAlign) {
        settings[`align${suffix}`] = devStyles.textAlign;
      }
      if (devStyles.width !== undefined) settings[`width${suffix}`] = this.dimension(devStyles.width);
      if (devStyles.gridColumns !== undefined) settings[`grid_columns_grid${suffix}`] = { unit: 'fr', size: devStyles.gridColumns };
      if (devStyles.flexWrap) settings[`flex_wrap${suffix}`] = devStyles.flexWrap;
      if (devStyles.maxWidth && typeof devStyles.maxWidth === 'number') {
        settings[`boxed_width${suffix}`] = { unit: 'px', size: devStyles.maxWidth, sizes: [] };
      }
    }
  }

  private mapSpacing(spacing: DIRSpacing): Record<string, any> {
    return {
      unit: 'px',
      top: String(spacing.top ?? 0),
      right: String(spacing.right ?? 0),
      bottom: String(spacing.bottom ?? 0),
      left: String(spacing.left ?? 0),
      isLinked: false,
    };
  }

  private mapBorderRadius(radius: any): Record<string, any> {
    if (typeof radius === 'number') {
      return {
        unit: 'px',
        top: String(radius),
        right: String(radius),
        bottom: String(radius),
        left: String(radius),
        isLinked: true,
      };
    }
    return {
      unit: 'px',
      top: String(radius.topLeft ?? 0),
      right: String(radius.topRight ?? 0),
      bottom: String(radius.bottomRight ?? 0),
      left: String(radius.bottomLeft ?? 0),
      isLinked: false,
    };
  }

  private mapJustifyContent(val: string): string {
    const map: Record<string, string> = {
      'center': 'center',
      'flex-start': 'flex-start',
      'flex-end': 'flex-end',
      'space-between': 'space-between',
      'space-around': 'space-around',
      'space-evenly': 'space-evenly',
    };
    return map[val] || 'flex-start';
  }

  private mapAlignItems(val: string): string {
    const map: Record<string, string> = {
      'center': 'center',
      'flex-start': 'flex-start',
      'flex-end': 'flex-end',
      'stretch': 'stretch',
    };
    return map[val] || 'stretch';
  }
}

export function convertDIRToElementor(
  dir: DIRDocument,
  options?: ConversionOptions
): { document: ElementorDocument; report: ConversionReport } {
  const generator = new ElementorGenerator(options);
  return generator.convert(dir);
}

export const generateElementorTemplate = convertDIRToElementor;

