import type { DIRDocument } from '../dir/types.js';

/** Compare each measured property with its corresponding compiled element, never a global search. */
export function auditCorrespondence(dir: DIRDocument, document: any, mapping: Record<string,string>): string[] {
  const elements = new Map<string,any>();
  const parents = new Map<string,string>();
  const index = (items: any[], parent = '') => items.forEach(el => {
    elements.set(el.id,el); parents.set(el.id,parent); index(el.elements || [],el.id);
  });
  index(document.content || []);
  const warnings: string[] = [];
  const walk = (node: any, parent?: any): void => {
    const element = elements.get(mapping[node.id]);
    if (!element) throw new Error(`Compiled element is missing for DIR node '${node.id}'`);
    if (parent && parents.get(element.id) !== mapping[parent.id]) throw new Error(`Compiled hierarchy differs at DIR node '${node.id}'`);
    const settings = element.settings || {};
    const expectedSize = node.styles?.fontSize ?? node.typography?.font_size_px;
    if (expectedSize !== undefined && ['heading','text','button'].includes(node.kind) && settings.typography_font_size?.size !== expectedSize) warnings.push(`Typography size differs at '${node.id}': expected ${expectedSize}`);
    const direction = node.direction || node.styles?.flexDirection;
    if (direction && settings.flex_direction !== direction) throw new Error(`Compiled layout direction differs at '${node.id}'`);
    if (node.kind === 'image') {
      const asset = dir.assets.find(a => a.id === node.assetId);
      const expected = node.url || node.imageUrl || asset?.url || asset?.placeholder;
      if (!expected || settings.image?.url !== expected) throw new Error(`Compiled image reference differs at '${node.id}'`);
    }
    if (['container','flex-group','grid-group','card','form',undefined].includes(node.kind)) {
      for (const child of node.children || []) walk(child,node);
    }
  };
  dir.pages.forEach(page => page.sections.forEach(section => walk(section)));
  return warnings;
}
