import { describe, it, expect } from 'vitest';
import { ElementorGenerator, canonicalizeFontFamily, isDarkColor, getEffectiveBackgroundColor } from '../modules/elementor/generator.js';
import type { DIRDocument } from '../modules/dir/types.js';

describe('Typography Engineering & Color Binding Pipeline', () => {
  const generator = new ElementorGenerator();

  describe('Google Fonts Canonicalization', () => {
    it('canonicalizes loose or generic font names to verified Google Fonts', () => {
      expect(canonicalizeFontFamily('sans-serif')).toBe('Inter');
      expect(canonicalizeFontFamily('modern sans')).toBe('Inter');
      expect(canonicalizeFontFamily('Plus Jakarta Sans')).toBe('Plus Jakarta Sans');
      expect(canonicalizeFontFamily('jakarta')).toBe('Plus Jakarta Sans');
      expect(canonicalizeFontFamily('poppins')).toBe('Poppins');
      expect(canonicalizeFontFamily('outfit')).toBe('Outfit');
      expect(canonicalizeFontFamily('montserrat')).toBe('Montserrat');
      expect(canonicalizeFontFamily('roboto')).toBe('Roboto');
      expect(canonicalizeFontFamily('roboto mono')).toBe('Roboto Mono');
      expect(canonicalizeFontFamily('serif')).toBe('Playfair Display');
      expect(canonicalizeFontFamily('playfair display')).toBe('Playfair Display');
      expect(canonicalizeFontFamily('dm sans')).toBe('DM Sans');
      expect(canonicalizeFontFamily('Space Grotesk')).toBe('Space Grotesk');
      expect(canonicalizeFontFamily('Syne')).toBe('Syne');
      expect(canonicalizeFontFamily('Clash Display')).toBe('Clash Display');
      expect(canonicalizeFontFamily('Satoshi')).toBe('Satoshi');
    });

    it('handles undefined or empty string by falling back to Plus Jakarta Sans', () => {
      expect(canonicalizeFontFamily(undefined)).toBe('Plus Jakarta Sans');
      expect(canonicalizeFontFamily('')).toBe('Plus Jakarta Sans');
    });
  });

  describe('Global Cascade & Widget-Specific Control Key Binding', () => {
    it('cascades global headingFont and bodyFont to headings, text, buttons, and nav menu', () => {
      const dir: any = {
        version: '1.0.0',
        meta: {
          sourceImageHash: 'test',
          sourceWidth: 1440,
          sourceHeight: 900,
          analysisProvider: 'test',
          analysisModel: 'test',
          analysisTimestamp: new Date().toISOString(),
          confidenceScore: 1.0,
          schemaVersion: '1.0.0',
          promptVersion: '2.1.0',
        },
        globals: {
          colors: {
            background: '#0B1120',
            text: '#F8FAFC',
            primary: '#38BDF8',
          },
          typography: {
            fontFamilies: ['Outfit', 'Inter'],
            headingFont: 'Outfit',
            bodyFont: 'Inter',
            baseSize: 16,
            scale: 1.25,
          },
        },
        pages: [
          {
            id: 'page_home',
            name: 'Home',
            sections: [
              {
                id: 'sec_header',
                role: 'header',
                children: [
                  {
                    id: 'nav_menu',
                    label: 'navigation-menu',
                    kind: 'container',
                    children: [
                      { id: 'l1', kind: 'link', text: 'Features', url: '#features' },
                      { id: 'l2', kind: 'link', text: 'Pricing', url: '#pricing' },
                    ],
                  },
                ],
              },
              {
                id: 'sec_hero',
                role: 'hero',
                styles: { backgroundColor: '#0B1120' },
                children: [
                  {
                    id: 'hero_heading',
                    kind: 'heading',
                    level: 1,
                    text: 'Next-Gen Financial Intelligence',
                    styles: {
                      fontSize: 56,
                      fontWeight: 700,
                      lineHeight: 1.15,
                      letterSpacing: -1,
                    },
                  },
                  {
                    id: 'hero_subtitle',
                    kind: 'text',
                    text: 'Automate accounting and cash flow with AI precision.',
                    styles: {
                      fontSize: 18,
                      fontWeight: 400,
                      lineHeight: 1.6,
                    },
                  },
                  {
                    id: 'hero_cta',
                    kind: 'button',
                    text: 'Get Started Free',
                    url: '#signup',
                    styles: {
                      backgroundColor: '#38BDF8',
                      fontSize: 16,
                      fontWeight: 600,
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = generator.convert(dir as DIRDocument);
      const sections = result.document.content;

      // 1. Check Header Nav Menu (Icon-List widget)
      const headerSection = sections[0];
      const navWidget = headerSection.elements[0];
      expect(navWidget.widgetType).toBe('icon-list');
      expect(navWidget.settings.typography_typography).toBe('custom');
      expect(navWidget.settings.typography_font_family).toBe('Inter');
      expect(navWidget.settings.text_color).toBe('#ffffff'); // High contrast on dark canvas

      // 2. Check Hero Heading
      const heroSection = sections[1];
      const headingWidget = heroSection.elements[0];
      expect(headingWidget.widgetType).toBe('heading');
      expect(headingWidget.settings.typography_typography).toBe('custom');
      expect(headingWidget.settings.typography_font_family).toBe('Outfit');
      expect(headingWidget.settings.typography_font_size).toEqual({ unit: 'px', size: 56 });
      expect(headingWidget.settings.typography_font_weight).toBe('700');
      expect(headingWidget.settings.typography_line_height).toEqual({ unit: 'em', size: 1.15 });
      expect(headingWidget.settings.typography_letter_spacing).toEqual({ unit: 'px', size: -1 });
      expect(headingWidget.settings.title_color).toBe('#F8FAFC'); // High contrast text on dark background

      // 3. Check Hero Text (Body copy)
      const textWidget = heroSection.elements[1];
      expect(textWidget.widgetType).toBe('text-editor');
      expect(textWidget.settings.typography_typography).toBe('custom');
      expect(textWidget.settings.typography_font_family).toBe('Inter');
      expect(textWidget.settings.typography_font_size).toEqual({ unit: 'px', size: 18 });
      expect(textWidget.settings.typography_font_weight).toBe('400');
      expect(textWidget.settings.text_color).toBe('#F8FAFC'); // Cascaded from dir.globals.colors.text

      // 4. Check Hero Button
      const buttonWidget = heroSection.elements[2];
      expect(buttonWidget.widgetType).toBe('button');
      expect(buttonWidget.settings.typography_typography).toBe('custom');
      expect(buttonWidget.settings.typography_font_family).toBe('Inter');
      expect(buttonWidget.settings.typography_font_size).toEqual({ unit: 'px', size: 16 });
      expect(buttonWidget.settings.typography_font_weight).toBe('600');
      expect(buttonWidget.settings.button_text_color).toBe('#060b05'); // High contrast dark text on bright sky blue button
    });

    it('respects local node typography overrides over global defaults', () => {
      const dir: any = {
        version: '1.0.0',
        meta: {
          sourceImageHash: 'test',
          sourceWidth: 1440,
          sourceHeight: 900,
          analysisProvider: 'test',
          analysisModel: 'test',
          analysisTimestamp: new Date().toISOString(),
          confidenceScore: 1.0,
          schemaVersion: '1.0.0',
          promptVersion: '2.1.0',
        },
        globals: {
          typography: {
            headingFont: 'Poppins',
            bodyFont: 'Inter',
          },
        },
        pages: [
          {
            id: 'page_main',
            sections: [
              {
                id: 'sec_1',
                role: 'content',
                children: [
                  {
                    id: 'special_heading',
                    kind: 'heading',
                    level: 2,
                    text: 'Serif Elegant Title',
                    styles: {
                      fontFamily: 'Playfair Display',
                      color: '#D97706',
                      textTransform: 'uppercase',
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = generator.convert(dir as DIRDocument);
      const heading = result.document.content[0].elements[0];

      expect(heading.settings.typography_font_family).toBe('Playfair Display');
      expect(heading.settings.title_color).toBe('#D97706');
      expect(heading.settings.typography_text_transform).toBe('uppercase');
    });

    it('binds correct color keys across counter and icon-box widgets', () => {
      const dir: any = {
        version: '1.0.0',
        meta: {
          sourceImageHash: 'test',
          sourceWidth: 1440,
          sourceHeight: 900,
          analysisProvider: 'test',
          analysisModel: 'test',
          analysisTimestamp: new Date().toISOString(),
          confidenceScore: 1.0,
          schemaVersion: '1.0.0',
          promptVersion: '2.1.0',
        },
        globals: {
          colors: { text: '#1E293B', background: '#F8FAFC' },
          typography: { headingFont: 'Montserrat' },
        },
        pages: [
          {
            id: 'page_stats',
            sections: [
              {
                id: 'sec_stats',
                role: 'stats',
                children: [
                  {
                    id: 'stat_counter',
                    kind: 'counter',
                    value: 250,
                    suffix: '+',
                    title: 'Active Clients',
                    styles: {
                      fontFamily: 'Montserrat',
                      color: '#2563EB',
                      fontSize: 40,
                    },
                  },
                  {
                    id: 'feature_box',
                    kind: 'icon-text',
                    title: 'Cloud Security',
                    text: 'End-to-end encrypted databases.',
                    styles: {
                      color: '#0F172A',
                      fontFamily: 'Montserrat',
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = generator.convert(dir as DIRDocument);
      const section = result.document.content[0];

      // Counter widget controls
      const counterWidget = section.elements[0];
      expect(counterWidget.widgetType).toBe('counter');
      expect(counterWidget.settings.number_color).toBe('#2563EB');
      expect(counterWidget.settings.title_color).toBe('#2563EB');
      expect(counterWidget.settings.typography_number_font_family).toBe('Montserrat');
      expect(counterWidget.settings.typography_title_font_family).toBe('Montserrat');

      // Icon-box widget controls
      const iconBoxWidget = section.elements[1];
      expect(iconBoxWidget.widgetType).toBe('icon-box');
      expect(iconBoxWidget.settings.title_color).toBe('#0F172A');
      expect(iconBoxWidget.settings.title_typography_font_family).toBe('Montserrat');
    });
  });

  describe('Dark Background Luminance & High-Contrast Safety', () => {
    it('correctly evaluates luminance and prevents black text on dark backgrounds', () => {
      expect(isDarkColor('#050A04')).toBe(true);
      expect(isDarkColor('#0B1120')).toBe(true);
      expect(isDarkColor('#182135')).toBe(true);
      expect(isDarkColor('#FFFFFF')).toBe(false);
      expect(isDarkColor('#F8FAFC')).toBe(false);

      const dir: any = {
        version: '1.0.0',
        meta: {
          sourceImageHash: 'test',
          sourceWidth: 1440,
          sourceHeight: 900,
          analysisProvider: 'test',
          analysisModel: 'test',
          analysisTimestamp: new Date().toISOString(),
          confidenceScore: 1.0,
          schemaVersion: '1.0.0',
          promptVersion: '2.1.0',
        },
        globals: {
          colors: { background: '#050A04' }, // Very dark near-black
        },
        pages: [
          {
            id: 'page_main',
            sections: [
              {
                id: 'sec_dark',
                role: 'hero',
                styles: { backgroundColor: '#050A04' },
                children: [
                  {
                    id: 'dark_heading',
                    kind: 'heading',
                    text: 'Unspecified Color Heading',
                  },
                  {
                    id: 'dark_text',
                    kind: 'text',
                    text: 'Unspecified Color Paragraph',
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = generator.convert(dir as DIRDocument);
      const heading = result.document.content[0].elements[0];
      const text = result.document.content[0].elements[1];

      expect(heading.settings.title_color).toBe('#ffffff');
      expect(text.settings.text_color).toBe('#e2e8f0');
    });
  });

  describe('Gradient Background & Chromatic Fidelity Engine', () => {
    it('generates Elementor native gradient controls on section and container', () => {
      const dir: any = {
        version: '1.0.0',
        meta: { sourceWidth: 1440, sourceHeight: 900 },
        globals: { colors: { background: '#1B2248' } },
        pages: [
          {
            id: 'page_grad',
            sections: [
              {
                id: 'sec_gradient',
                role: 'hero',
                styles: {
                  backgroundGradient: {
                    type: 'linear',
                    startColor: '#1B2248',
                    endColor: '#141B3C',
                    angle: 180,
                  },
                },
                children: [
                  {
                    id: 'cta_btn',
                    kind: 'button',
                    text: 'Get Started',
                    styles: {
                      backgroundGradient: 'linear-gradient(90deg, #E7C69F 0%, #EDC188 100%)',
                    },
                  },
                  {
                    id: 'email_input',
                    kind: 'input',
                    placeholder: 'Enter your email',
                    styles: {
                      backgroundColor: 'rgba(255, 255, 255, 0.08)',
                      borderRadius: 50,
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = generator.convert(dir as DIRDocument);
      const section = result.document.content[0];

      // 1. Verify Section Gradient Settings
      expect(section.settings.background_background).toBe('gradient');
      expect(section.settings.background_color).toBe('#1B2248');
      expect(section.settings.background_color_b).toBe('#141B3C');
      expect(section.settings.background_gradient_angle).toEqual({ unit: 'deg', size: 180 });

      // 2. Verify Button Gradient & Pill Border Radius
      const btn = section.elements[0];
      expect(btn.widgetType).toBe('button');
      expect(btn.settings.background_background).toBe('gradient');
      expect(btn.settings.background_color).toBe('#E7C69F');
      expect(btn.settings.background_color_b).toBe('#EDC188');
      expect(btn.settings.border_radius).toEqual({
        unit: 'px',
        top: '50',
        right: '50',
        bottom: '50',
        left: '50',
        isLinked: true,
      });

      // 3. Verify Input HTML structure
      const input = section.elements[1];
      expect(input.widgetType).toBe('html');
      expect(input.settings.html).toContain('rgba(255, 255, 255, 0.08)');
      expect(input.settings.html).toContain('border-radius: 50px');
    });

    it('injects page-level gradient into page_settings when document canvas is gradient', () => {
      const dir: any = {
        version: '1.0.0',
        meta: { sourceWidth: 1440, sourceHeight: 900 },
        globals: {
          colors: {
            backgroundGradient: 'linear-gradient(180deg, #1B2248 0%, #141B3C 100%)',
          },
        },
        pages: [
          {
            id: 'page_main',
            sections: [
              {
                id: 'sec_1',
                children: [{ id: 't1', kind: 'text', text: 'Hello' }],
              },
            ],
          },
        ],
      };

      const result = generator.convert(dir as DIRDocument);
      const pageSettings = result.document.page_settings;
      expect(pageSettings).toBeDefined();
      expect(pageSettings!.background_background).toBe('gradient');
      expect(pageSettings!.background_color).toBe('#1B2248');
      expect(pageSettings!.background_color_b).toBe('#141B3C');
      expect(pageSettings!.background_gradient_angle).toEqual({ unit: 'deg', size: 180 });
    });
  });
});

