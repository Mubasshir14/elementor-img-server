import { describe, it, expect } from 'vitest';
import { normalizeDIR } from '../modules/dir/normalizer.js';
import { ElementorGenerator } from '../modules/elementor/generator.js';
import type { DIRDocument } from '../modules/dir/types.js';

describe('Navbar Structure & Layout Alignment', () => {
  const generator = new ElementorGenerator();

  it('separates loose header elements into canonical 3-slot layout (Logo, Menu, Actions)', () => {
    const rawDIR: any = {
      schemaVersion: '1.0.0',
      id: 'doc_test_navbar',
      name: 'Navbar Test',
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
                  id: 'img_logo',
                  kind: 'image',
                  alt: 'BrainGig Logo',
                  url: 'https://example.com/logo.png',
                  styles: { width: 89, height: 32 },
                },
                { id: 'link_home', kind: 'link', text: 'Home', url: '#' },
                { id: 'link_about', kind: 'link', text: 'About', url: '#about' },
                { id: 'link_services', kind: 'link', text: 'Services', url: '#services' },
                { id: 'btn_contact', kind: 'button', text: 'Contact Us', url: '#contact' },
              ],
            },
          ],
        },
      ],
    };

    const normalized = normalizeDIR(rawDIR) as DIRDocument;
    const headerSection = normalized.pages[0].sections[0];

    // Canonical 3 slots
    expect(headerSection.children).toHaveLength(3);

    // Slot 1: Logo
    const logoNode = headerSection.children[0] as any;
    expect(logoNode.kind).toBe('image');
    expect(logoNode.label).toBe('logo');
    expect(logoNode.styles.width).toBe(89);

    // Slot 2: Navigation Menu
    const menuNode = headerSection.children[1] as any;
    expect(menuNode.label).toBe('navigation-menu');
    expect(menuNode.direction).toBe('row');
    expect(menuNode.children).toHaveLength(3);

    // Slot 3: Action Button
    const actionNode = headerSection.children[2] as any;
    expect(actionNode.kind).toBe('button');
    expect(actionNode.text).toBe('Contact Us');
  });

  it('generates Elementor row layout with space-between and pixel width for logo (never percentage)', () => {
    const rawDIR: any = {
      schemaVersion: '1.0.0',
      id: 'doc_test_navbar_elementor',
      name: 'Navbar Elementor Test',
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
                  id: 'img_logo',
                  kind: 'image',
                  alt: 'BrainGig Logo',
                  url: 'https://example.com/logo.png',
                  styles: { width: 89, height: 32 },
                },
                { id: 'link_home', kind: 'link', text: 'Home', url: '#' },
                { id: 'link_about', kind: 'link', text: 'About', url: '#about' },
                { id: 'btn_get_started', kind: 'button', text: 'Get Started', url: '#' },
              ],
            },
          ],
        },
      ],
    };

    const normalized = normalizeDIR(rawDIR) as DIRDocument;
    const result = generator.convert(normalized);
    const headerElement = result.document.content[0];

    // 1. Header container layout: horizontal row with space-between
    expect(headerElement.settings.container_type).toBe('flex');
    expect(headerElement.settings.flex_direction).toBe('row');
    expect(headerElement.settings.flex_justify_content).toBe('space-between');
    expect(headerElement.settings.flex_align_items).toBe('center');
    expect(headerElement.settings.flex_direction_tablet).toBe('row');
    expect(headerElement.settings.flex_direction_mobile).toBe('row');

    // 2. Elements rendered
    expect(headerElement.elements).toHaveLength(3);

    // Logo image widget: unit MUST be 'px' (not 89%)
    const logoWidget = headerElement.elements[0];
    expect(logoWidget.widgetType).toBe('image');
    expect(logoWidget.settings.width).toEqual({ unit: 'px', size: 89 });
    expect(logoWidget.settings.align).toBe('left');
    expect(logoWidget.settings.align_self).toBe('center');

    // Navigation menu: mapped to inline icon-list widget
    const menuWidget = headerElement.elements[1];
    expect(menuWidget.widgetType).toBe('icon-list');
    expect(menuWidget.settings.view).toBe('inline');
    expect(menuWidget.settings.align_self).toBe('center');
    expect(menuWidget.settings.icon_list).toHaveLength(2);

    // Action button widget
    const buttonWidget = headerElement.elements[2];
    expect(buttonWidget.widgetType).toBe('button');
    expect(buttonWidget.settings.text).toBe('Get Started');
  });

  it('preserves multi-action buttons row layout across tablet and mobile viewports', () => {
    const rawDIR: any = {
      schemaVersion: '1.0.0',
      id: 'doc_test_multi_btn',
      name: 'Multi Button Navbar',
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
                  id: 'brand_heading',
                  kind: 'heading',
                  text: 'TravelAgency',
                  level: 2,
                },
                { id: 'link_tours', kind: 'link', text: 'Tours', url: '#' },
                { id: 'link_dest', kind: 'link', text: 'Destinations', url: '#' },
                { id: 'btn_login', kind: 'button', text: 'Log In', url: '#login' },
                { id: 'btn_signup', kind: 'button', text: 'Sign Up', url: '#signup' },
              ],
            },
          ],
        },
      ],
    };

    const normalized = normalizeDIR(rawDIR) as DIRDocument;
    const headerSection = normalized.pages[0].sections[0];

    // Slot 1 is text brand logo
    expect((headerSection.children[0] as any).label).toBe('logo');

    // Slot 3 is header-actions flex-group
    const actionsGroup = headerSection.children[2] as any;
    expect(actionsGroup.label).toBe('header-actions');
    expect(actionsGroup.children).toHaveLength(2);

    const result = generator.convert(normalized);
    const headerElement = result.document.content[0];
    const actionsContainer = headerElement.elements[2];

    expect(actionsContainer.elType).toBe('container');
    expect(actionsContainer.settings.flex_direction).toBe('row');
    expect(actionsContainer.settings.flex_direction_tablet).toBe('row');
    expect(actionsContainer.settings.flex_direction_mobile).toBe('row');
    expect(actionsContainer.settings.flex_justify_content).toBe('flex-end');
    expect(actionsContainer.settings.flex_grow).toBe(0);
  });

  it('correctly handles full Marvelous Destinations navbar: preserves 1-line menu and groups actions cleanly', () => {
    const rawDIR: any = {
      schemaVersion: '1.0.0',
      id: 'doc_marvelous_nav',
      name: 'Marvelous Destinations',
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
                  id: 'asset_logo',
                  kind: 'image',
                  alt: 'Marvelous Destinations',
                  url: 'https://example.com/logo.png',
                  styles: { width: 156, height: 72 },
                },
                {
                  id: 'nav_menu_container',
                  kind: 'flex-group',
                  children: [
                    { id: 'link_dest', kind: 'link', text: 'Destinations', url: '#' },
                    { id: 'link_hotel', kind: 'link', text: 'Hotels', url: '#' },
                    { id: 'link_flight', kind: 'link', text: 'Flights', url: '#' },
                    { id: 'link_book', kind: 'link', text: 'Bookings', url: '#' },
                  ],
                },
                {
                  id: 'actions_container',
                  kind: 'flex-group',
                  children: [
                    { id: 'btn_login', kind: 'button', text: 'Login', url: '#login' },
                    { id: 'btn_signup', kind: 'button', text: 'Sign up', url: '#signup', styles: { backgroundColor: '#3b82f6', color: '#ffffff' } },
                    { id: 'btn_lang', kind: 'button', text: 'EN ⌄', url: '#' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const normalized = normalizeDIR(rawDIR) as DIRDocument;
    const result = generator.convert(normalized);
    const headerElement = result.document.content[0];

    // Header container: row with space-between
    expect(headerElement.settings.flex_direction).toBe('row');
    expect(headerElement.settings.flex_justify_content).toBe('space-between');
    expect(headerElement.settings.flex_align_items).toBe('center');
    expect(headerElement.settings.padding).toBeDefined();

    // 3 slots
    expect(headerElement.elements).toHaveLength(3);

    // Slot 1: Logo
    const logoEl = headerElement.elements[0];
    expect(logoEl.widgetType).toBe('image');
    expect(logoEl.settings.width).toEqual({ unit: 'px', size: 156 });
    expect(logoEl.settings.height.size).toBeLessThanOrEqual(52); // bounded height
    expect(logoEl.settings.align).toBe('left');
    expect(logoEl.settings._flex_shrink).toBe(0);
    expect(logoEl.settings._flex_grow).toBe(0);

    // Slot 2: Menu (icon-list)
    const menuEl = headerElement.elements[1];
    expect(menuEl.widgetType).toBe('icon-list');
    expect(menuEl.settings.view).toBe('inline');
    expect(menuEl.settings._element_width).toBe('custom');
    expect(menuEl.settings._element_custom_width.unit).toBe('px');
    expect(menuEl.settings._element_custom_width.size).toBeGreaterThan(300);
    expect(menuEl.settings.width.unit).toBe('px');
    expect(menuEl.settings.width.size).toBeGreaterThan(300); // calculated width to prevent wrapping
    expect(menuEl.settings._flex_shrink).toBe(0);
    expect(menuEl.settings._flex_grow).toBe(0);
    expect(menuEl.settings.icon_list).toHaveLength(4);

    // Slot 3: Actions container
    const actionsEl = headerElement.elements[2];
    expect(actionsEl.elType).toBe('container');
    expect(actionsEl.settings.flex_direction).toBe('row');
    expect(actionsEl.settings.flex_justify_content).toBe('flex-end');
    expect(actionsEl.settings.flex_grow).toBe(0);
    expect(actionsEl.settings._flex_grow).toBe(0);
    expect(actionsEl.settings.flex_shrink).toBe(0);
    expect(actionsEl.settings.flex_wrap).toBe('nowrap');

    // Individual action items inside Slot 3
    expect(actionsEl.elements).toHaveLength(3);
    for (const btn of actionsEl.elements) {
      expect(btn.widgetType).toBe('button');
      expect(btn.settings._element_width).toBe('initial');
      expect(btn.settings._flex_grow).toBe(0);
      expect(btn.settings._flex_shrink).toBe(0);
    }
  });
});
