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

export function generateElementId(): string {
  return crypto.randomBytes(4).toString('hex');
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

  constructor(options: ConversionOptions = {}) {
    this.options = {
      preferContainers: true,
      targetProfile: 'core',
      ...options,
    };
  }

  public convert(dir: DIRDocument): { document: ElementorDocument; report: ConversionReport } {
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

    const pageBg = dir.globals?.colors?.background || dir.globals?.colors?.surface || '#ffffff';

    const document: ElementorDocument = {
      version: '0.4',
      title: page?.name || 'Imported Design',
      type: 'page',
      page_settings: {
        template: 'elementor_canvas',
        background_background: 'classic',
        background_color: pageBg,
      },
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
    const containerMaxWidth = dir.globals?.spacing?.containerMaxWidth || 1200;
    const settings: Record<string, any> = {
      container_type: 'flex',
      flex_direction: 'column',
      content_width: 'boxed',
      boxed_width: { unit: 'px', size: containerMaxWidth, sizes: [] },
      boxed_width_tablet: { unit: 'px', size: Math.min(768, containerMaxWidth), sizes: [] },
      boxed_width_mobile: { unit: 'px', size: 360, sizes: [] },
      _section_role: section.role,
    };

    this.applyStylesToSettings(section.styles, settings, true);

    if (section.responsiveOverrides) {
      this.applyResponsiveOverrides(section.responsiveOverrides, settings, true);
      this.explicitResponsiveCount++;
    }

    // If section background is missing or transparent, inherit page background from globals
    if (!settings.background_color || settings.background_color === 'transparent') {
      settings.background_background = 'classic';
      settings.background_color = pageBg;
    }

    const elements: ElementorElement[] = [];
    for (const child of section.children) {
      const el = this.convertNode(child, dir);
      if (el) elements.push(el);
    }

    return {
      id: generateElementId(),
      elType: 'container',
      settings,
      elements,
    };
  }

  private convertNode(node: DIRNode, dir: DIRDocument): ElementorElement | null {
    if (!node) return null;

    switch (node.kind) {
      case 'container':
      case 'flex-group':
      case 'grid-group':
      case 'card':
      case 'form':
        return this.convertContainerNode(node, dir);

      case 'heading':
        return this.convertHeadingNode(node as DIRHeadingNode);

      case 'text':
        return this.convertTextNode(node as DIRTextNode);

      case 'button':
        return this.convertButtonNode(node as DIRButtonNode);

      case 'image':
        return this.convertImageNode(node as DIRImageNode, dir);

      case 'icon':
        return this.convertIconNode(node as DIRIconNode);

      case 'icon-text':
        return this.convertIconBoxNode(node as DIRIconTextNode);

      case 'list':
        return this.convertListNode(node as DIRListNode);

      case 'divider':
        return this.convertDividerNode(node as DIRDividerNode);

      case 'spacer':
        return this.convertSpacerNode(node as DIRSpacerNode);

      case 'counter':
        return this.convertCounterNode(node as DIRCounterNode);

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
        return this.convertLinkAsButton(node);

      case 'badge':
        return this.convertBadgeAsHeading(node, dir);

      case 'list-item':
        return this.convertTextNode({
          ...node,
          kind: 'text',
          html: `<p>${(node as any).text || ''}</p>`,
        } as DIRTextNode);

      case 'input':
        return this.convertFallbackNode(node);

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
    if (
      Array.isArray(node.children) &&
      node.children.length > 0 &&
      node.children.every((c: any) => c.kind === 'link')
    ) {
      this.widgetCount++;
      this.widgetsUsed.add('icon-list');

      const iconList = node.children.map((c: any) => ({
        _id: generateElementId().slice(0, 7),
        text: c.text || 'Link',
        link: { url: c.url || '#' },
        selected_icon: { value: '', library: '' },
      }));

      return {
        id: generateElementId(),
        elType: 'widget',
        widgetType: 'icon-list',
        settings: {
          view: 'inline',
          icon_list: iconList,
          text_color: node.children[0]?.styles?.color || '#b0b8af',
          space_between: { unit: 'px', size: node.gap || 28 },
          typography_typography: 'custom',
          typography_font_size: { unit: 'px', size: node.children[0]?.styles?.fontSize || 14 },
          typography_font_weight: '400',
        },
        elements: [],
      };
    }

    const isGrid = node.kind === 'grid-group';
    const settings: Record<string, any> = {
      container_type: isGrid ? 'grid' : 'flex',
    };

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
      if (node.gap) {
        settings.grid_gap = {
          unit: 'px',
          column: node.gap,
          row: node.gap,
          isLinked: true,
        };
        settings.grid_gap_tablet = {
          unit: 'px',
          column: Math.max(12, Math.round(node.gap * 0.75)),
          row: Math.max(12, Math.round(node.gap * 0.75)),
          isLinked: true,
        };
        settings.grid_gap_mobile = {
          unit: 'px',
          column: Math.max(8, Math.round(node.gap * 0.5)),
          row: Math.max(8, Math.round(node.gap * 0.5)),
          isLinked: true,
        };
      }
      this.inferredResponsiveCount++;
    } else {
      const flexDir = node.direction || (node.styles as any)?.flexDirection || 'column';
      settings.flex_direction = flexDir;
      if (flexDir === 'row') {
        settings.flex_direction_tablet = 'column';
        settings.flex_direction_mobile = 'column';
        this.inferredResponsiveCount++;
      }
      const justify = node.justifyContent || (node.styles as any)?.justifyContent;
      if (justify) settings.flex_justify_content = this.mapJustifyContent(justify);
      const align = node.alignItems || (node.styles as any)?.alignItems;
      if (align) settings.flex_align_items = this.mapAlignItems(align);
      const wrap = node.wrap || (node.styles as any)?.flexWrap === 'wrap';
      if (wrap) settings.flex_wrap = 'wrap';
      const gap = node.gap ?? (node.styles as any)?.gap;
      if (gap !== undefined) {
        settings.flex_gap = { unit: 'px', size: gap };
        settings.flex_gap_tablet = { unit: 'px', size: Math.max(10, Math.round(gap * 0.75)) };
        settings.flex_gap_mobile = { unit: 'px', size: Math.max(6, Math.round(gap * 0.5)) };
      }
      if ((node.styles as any)?.alignSelf) {
        settings.align_self = this.mapAlignItems((node.styles as any).alignSelf);
      }
    }

    this.applyStylesToSettings(node.styles, settings, true);

    if (node.responsiveOverrides) {
      this.applyResponsiveOverrides(node.responsiveOverrides, settings, true);
      this.explicitResponsiveCount++;
    }

    const elements: ElementorElement[] = [];
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const el = this.convertNode(child, dir);
        if (el) elements.push(el);
      }
    }

    return {
      id: generateElementId(),
      elType: 'container',
      settings,
      elements,
    };
  }

  private convertHeadingNode(node: DIRHeadingNode): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('heading');

    const settings: Record<string, any> = {
      title: node.text || '',
      header_size: `h${node.level || 2}`,
    };

    if (node.styles?.textAlign) {
      settings.align = node.styles.textAlign;
    }
    if (node.styles?.color) {
      settings.title_color = node.styles.color;
    }

    this.applyTypographyStyles(node.styles, settings);

    if (node.responsiveOverrides) {
      this.applyResponsiveOverrides(node.responsiveOverrides, settings, false);
      this.explicitResponsiveCount++;
    }

    return {
      id: generateElementId(),
      elType: 'widget',
      widgetType: 'heading',
      settings,
      elements: [],
    };
  }

  private convertTextNode(node: DIRTextNode): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('text-editor');

    const settings: Record<string, any> = {
      editor: node.html || node.text || '<p></p>',
    };

    if (node.styles?.textAlign) {
      settings.align = node.styles.textAlign;
    }
    if (node.styles?.color) {
      settings.text_color = node.styles.color;
    }

    this.applyTypographyStyles(node.styles, settings);

    if (node.responsiveOverrides) {
      this.applyResponsiveOverrides(node.responsiveOverrides, settings, false);
      this.explicitResponsiveCount++;
    }

    return {
      id: generateElementId(),
      elType: 'widget',
      widgetType: 'text-editor',
      settings,
      elements: [],
    };
  }

  private convertButtonNode(node: DIRButtonNode): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('button');

    const settings: Record<string, any> = {
      text: node.text || 'Click here',
      link: { url: node.url || '#' },
      size: node.size === 'large' ? 'lg' : node.size === 'small' ? 'sm' : 'md',
    };

    if (node.styles?.backgroundColor) {
      settings.background_color = node.styles.backgroundColor;
    }
    if (node.styles?.color) {
      settings.button_text_color = node.styles.color;
    }
    if (node.styles?.borderRadius) {
      settings.border_radius = this.mapBorderRadius(node.styles.borderRadius);
    }
    if (node.styles?.padding) {
      settings.button_padding = this.mapSpacing(node.styles.padding);
      settings.button_padding_tablet = this.mapScaledSpacing(node.styles.padding, 0.8, 0.75);
      settings.button_padding_mobile = this.mapScaledSpacing(node.styles.padding, 0.65, 0.6, 10);
      this.inferredResponsiveCount++;
    }
    if (node.styles?.textAlign) {
      settings.align = node.styles.textAlign;
    }

    this.applyTypographyStyles(node.styles, settings);

    if (node.responsiveOverrides) {
      this.applyResponsiveOverrides(node.responsiveOverrides, settings, false);
      this.explicitResponsiveCount++;
    }

    return {
      id: generateElementId(),
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

    let imageUrl = (node as any).url || '';
    if (!imageUrl && node.assetId) {
      const asset = dir.assets?.find((a) => a.id === node.assetId);
      if (asset) {
        imageUrl = asset.placeholder || (asset as any).url || '';
      }
    }

    const settings: Record<string, any> = {
      image: { url: imageUrl || '', id: (node as any).assetId || '' },
      image_size: 'full',
      align: 'center',
    };

    if (node.alt) {
      settings.caption = node.alt;
      settings.alt_text = node.alt;
    }
    if (node.styles?.width) {
      settings.width = typeof node.styles.width === 'number'
        ? { unit: 'px', size: node.styles.width }
        : { unit: '%', size: 100 };
      if (typeof node.styles.width === 'number' && node.styles.width > 360) {
        settings.width_tablet = { unit: 'px', size: Math.min(640, node.styles.width) };
        settings.width_mobile = { unit: '%', size: 100 };
        this.inferredResponsiveCount++;
      }
    }
    if (node.styles?.borderRadius) {
      settings.border_radius = this.mapBorderRadius(node.styles.borderRadius);
    }
    if (node.styles?.height && typeof node.styles.height === 'number') {
      settings.height = { unit: 'px', size: node.styles.height };
    }
    if ((node as any).objectFit) {
      settings.image_fit = (node as any).objectFit;
    }

    if (node.responsiveOverrides) {
      this.applyResponsiveOverrides(node.responsiveOverrides, settings, false);
      this.explicitResponsiveCount++;
    }

    return {
      id: generateElementId(),
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
      id: generateElementId(),
      elType: 'widget',
      widgetType: 'icon',
      settings,
      elements: [],
    };
  }

  private convertIconBoxNode(node: DIRIconTextNode): ElementorElement {
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

    if (node.styles?.color) settings.title_color = node.styles.color;

    return {
      id: generateElementId(),
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
      text: item.text || 'List item',
      selected_icon: {
        value: item.icon ? `fas fa-${item.icon}` : 'fas fa-check',
        library: 'fa-solid',
      },
    }));

    return {
      id: generateElementId(),
      elType: 'widget',
      widgetType: 'icon-list',
      settings: {
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
      id: generateElementId(),
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
      id: generateElementId(),
      elType: 'widget',
      widgetType: 'spacer',
      settings: {
        space: { unit: 'px', size: node.height || 50 },
      },
      elements: [],
    };
  }

  private convertCounterNode(node: DIRCounterNode): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('counter');

    const settings: Record<string, any> = {
      starting_number: 0,
      ending_number: node.value || 100,
      prefix: node.prefix || '',
      suffix: node.suffix || '',
      title: node.title || '',
    };

    if (node.styles?.color) {
      settings.number_color = node.styles.color;
      settings.title_color = node.styles.color;
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
    }

    if (node.responsiveOverrides) {
      this.applyResponsiveOverrides(node.responsiveOverrides, settings, false);
      this.explicitResponsiveCount++;
    }

    return {
      id: generateElementId(),
      elType: 'widget',
      widgetType: 'counter',
      settings,
      elements: [],
    };
  }

  private convertProgressNode(node: DIRProgressBarNode): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('progress');

    return {
      id: generateElementId(),
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
      social_icon: {
        value: `fab fa-${p.name.toLowerCase()}`,
        library: 'fa-brands',
      },
      link: { url: p.url || '#' },
    }));

    return {
      id: generateElementId(),
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
      tab_title: t.title || 'Tab',
      tab_content: this.extractChildContent(t.children),
    }));

    return {
      id: generateElementId(),
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
      tab_title: item.title || 'Accordion Item',
      tab_content: this.extractChildContent(item.children),
    }));

    return {
      id: generateElementId(),
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
      id: generateElementId(),
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
      id: generateElementId(),
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
      id: generateElementId(),
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

  private convertLinkAsButton(node: any): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('button');

    return {
      id: generateElementId(),
      elType: 'widget',
      widgetType: 'button',
      settings: {
        text: node.text || 'Link',
        link: { url: node.url || '#' },
        button_type: 'default',
        background_color: 'transparent',
        button_text_color: node.styles?.color || '#ffffff',
        button_padding: { top: '0', right: '0', bottom: '0', left: '0', unit: 'px', isLinked: true },
        typography_typography: 'custom',
        typography_font_size: { unit: 'px', size: node.styles?.fontSize || 14 },
      },
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

    return {
      id: generateElementId(),
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
          id: generateElementId(),
          elType: 'widget',
          widgetType: 'heading',
          settings: {
            title: node.text || '',
            header_size: 'span',
            title_color: textColor,
            align: 'center',
            typography_typography: 'custom',
            typography_font_size: { unit: 'px', size: fontSize },
            typography_font_weight: '600',
          },
          elements: [],
        },
      ],
    };
  }

  private convertFallbackNode(node: any): ElementorElement {
    this.widgetCount++;
    this.elementCount++;
    this.widgetsUsed.add('text-editor');

    return {
      id: generateElementId(),
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

    if (styles.backgroundColor) {
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

    if (styles.borderRadius) {
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

    if (styles.width) {
      if (typeof styles.width === 'number') {
        settings.width = { unit: 'px', size: styles.width };
        if (styles.width > 360) {
          settings.width_tablet = { unit: 'px', size: Math.min(680, styles.width) };
          settings.width_mobile = { unit: '%', size: 100 };
          this.inferredResponsiveCount++;
        }
      } else if (styles.width === '100%') {
        settings.content_width = 'full';
      }
    }

    if (styles.maxWidth && typeof styles.maxWidth === 'number') {
      settings.boxed_width = { unit: 'px', size: styles.maxWidth, sizes: [] };
      settings.boxed_width_tablet = { unit: 'px', size: Math.min(768, styles.maxWidth), sizes: [] };
      settings.boxed_width_mobile = { unit: 'px', size: 360, sizes: [] };
      this.inferredResponsiveCount++;
    }

    const minH = styles.minHeight ?? (isContainer ? styles.height : undefined);
    if (minH !== undefined) {
      if (typeof minH === 'number') {
        settings.height = 'min-height';
        settings.custom_height = { unit: 'px', size: minH, sizes: [] };
        if (minH > 400) {
          settings.custom_height_tablet = { unit: 'px', size: Math.round(minH * 0.8), sizes: [] };
          settings.custom_height_mobile = { unit: 'px', size: Math.max(280, Math.round(minH * 0.65)), sizes: [] };
          this.inferredResponsiveCount++;
        }
      } else if (typeof minH === 'string' && minH.endsWith('vh')) {
        const val = parseInt(minH, 10);
        settings.height = 'min-height';
        settings.custom_height = { unit: 'vh', size: val, sizes: [] };
        settings.custom_height_tablet = { unit: 'vh', size: Math.max(50, Math.round(val * 0.9)), sizes: [] };
        settings.custom_height_mobile = { unit: 'vh', size: Math.max(40, Math.round(val * 0.8)), sizes: [] };
        this.inferredResponsiveCount++;
      }
    }

    if (styles.backgroundImage && isContainer) {
      settings.background_background = 'classic';
      settings.background_image = { url: styles.backgroundImage, id: '' };
      if (styles.backgroundPosition) settings.background_position = styles.backgroundPosition;
      if (styles.backgroundSize) settings.background_size = styles.backgroundSize;
      settings.background_repeat = 'no-repeat';
    }
  }

  private applyTypographyStyles(styles: DIRStyles | undefined, settings: Record<string, any>): void {
    if (!styles) return;

    let hasTypo = false;
    if (styles.fontFamily) {
      settings.typography_font_family = styles.fontFamily;
      hasTypo = true;
    }
    if (styles.fontSize) {
      settings.typography_font_size = { unit: 'px', size: styles.fontSize };
      hasTypo = true;
      if (styles.fontSize >= 44) {
        settings.typography_font_size_tablet = { unit: 'px', size: Math.round(styles.fontSize * 0.8) };
        settings.typography_font_size_mobile = { unit: 'px', size: Math.max(24, Math.round(styles.fontSize * 0.6)) };
        this.inferredResponsiveCount++;
      } else if (styles.fontSize >= 28) {
        settings.typography_font_size_tablet = { unit: 'px', size: Math.round(styles.fontSize * 0.85) };
        settings.typography_font_size_mobile = { unit: 'px', size: Math.max(20, Math.round(styles.fontSize * 0.72)) };
        this.inferredResponsiveCount++;
      } else if (styles.fontSize >= 18) {
        settings.typography_font_size_mobile = { unit: 'px', size: Math.max(15, Math.round(styles.fontSize * 0.88)) };
        this.inferredResponsiveCount++;
      }
    }
    if (styles.fontWeight) {
      settings.typography_font_weight = String(styles.fontWeight);
      hasTypo = true;
    }
    if (styles.lineHeight) {
      const lh = typeof styles.lineHeight === 'number' ? styles.lineHeight : 1.5;
      settings.typography_line_height = { unit: 'em', size: lh };
      settings.typography_line_height_tablet = { unit: 'em', size: Math.max(1.2, Math.round(lh * 0.95 * 10) / 10) };
      settings.typography_line_height_mobile = { unit: 'em', size: Math.max(1.2, Math.round(lh * 0.9 * 10) / 10) };
      hasTypo = true;
    }
    if (styles.letterSpacing !== undefined) {
      settings.typography_letter_spacing = { unit: 'px', size: styles.letterSpacing };
      hasTypo = true;
    }
    if (styles.textTransform) {
      settings.typography_text_transform = styles.textTransform;
      hasTypo = true;
    }
    if (styles.textDecoration) {
      settings.typography_text_decoration = styles.textDecoration;
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
    isContainer: boolean
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
      if (devStyles.width) {
        settings[`width${suffix}`] = typeof devStyles.width === 'number'
          ? { unit: 'px', size: devStyles.width }
          : { unit: '%', size: 100 };
      }
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

