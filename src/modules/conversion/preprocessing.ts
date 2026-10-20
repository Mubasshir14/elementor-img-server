import { createAnalysisCopy, createTiles } from '../storage/image-processor.js';
import type { SourceImage } from '../storage/image-input.js';
import type { DIRDocument, DIRRect } from '../dir/types.js';

export interface AnalysisTile {
  buffer: Buffer; width: number; height: number; mimeType: string;
  originalWidth: number; originalHeight: number; yOffset: number; index: number; totalTiles: number;
}
export async function prepareAnalysisImages(source: SourceImage): Promise<AnalysisTile[]> {
  const tall = source.height > Math.max(3000, source.width * 2.5);
  const tiles = tall ? await createTiles(source.buffer, 2400, 400) : [{
    buffer: source.buffer, width: source.width, height: source.height,
    yOffset: 0, index: 0, totalTiles: 1,
  }];
  const result: AnalysisTile[] = [];
  for (const tile of tiles) {
    const copy = await createAnalysisCopy(tile.buffer);
    result.push({ ...copy, originalWidth: tile.width, originalHeight: tile.height,
      yOffset: tile.yOffset, index: tile.index, totalTiles: tile.totalTiles });
  }
  return result;
}
export function toOriginalRect(rect: DIRRect, tile: AnalysisTile): DIRRect {
  const sx = tile.originalWidth / tile.width, sy = tile.originalHeight / tile.height;
  if (!Object.values(rect).every(Number.isFinite) || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 ||
      rect.x + rect.width > tile.width + 1 || rect.y + rect.height > tile.height + 1) {
    throw new Error('Detected bounds lie outside the analysis image');
  }
  return { x: rect.x * sx, y: tile.yOffset + rect.y * sy, width: rect.width * sx, height: rect.height * sy };
}
function overlap(a?: DIRRect, b?: DIRRect): number {
  if (!a || !b) return 0;
  const intersection = Math.max(0, Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)) *
    Math.max(0, Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  return intersection / Math.min(a.width*a.height,b.width*b.height);
}
function union(a: DIRRect, b: DIRRect): DIRRect {
  const x = Math.min(a.x,b.x), y = Math.min(a.y,b.y);
  return { x,y,width: Math.max(a.x+a.width,b.x+b.width)-x,height: Math.max(a.y+a.height,b.y+b.height)-y };
}
function signature(node: any): string {
  return String(node.text || node.html || node.alt || node.label || '').trim().toLowerCase();
}
function mergeNodes(target: any[], incoming: any[], sections = false): void {
  for (const node of incoming) {
    const match = target.find(other => (sections ? other.role === node.role : other.kind === node.kind) &&
      overlap(other.sourceRect,node.sourceRect) >= 0.55 &&
      (signature(other) === signature(node) || (sections && other.role !== 'generic')));
    if (!match) { target.push(node); continue; }
    if (match.children && node.children) mergeNodes(match.children,node.children);
    match.sourceRect = union(match.sourceRect,node.sourceRect);
    match.confidence = Math.min(match.confidence,node.confidence);
  }
  target.sort((a,b) => (a.sourceRect?.y ?? 0)-(b.sourceRect?.y ?? 0) || (a.sourceRect?.x ?? 0)-(b.sourceRect?.x ?? 0));
}
/** Transform measurements before asset cropping; namespace IDs before merging overlaps. */
export function mergeTileDocuments(inputs: { document: DIRDocument; tile: AnalysisTile }[], source: SourceImage): DIRDocument {
  if (!inputs.length) throw new Error('No image analyses were returned');
  const docs = inputs.map(({document,tile}) => {
    const doc = structuredClone(document);
    const prefix = `tile${tile.index}_`;
    const sx = tile.originalWidth/tile.width, sy = tile.originalHeight/tile.height;
    const transform = (obj: any): void => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) { obj.forEach(transform); return; }
      if (obj.id) obj.id = prefix + obj.id;
      for (const key of ['assetId','backgroundImageAssetId']) if (obj[key]) obj[key] = prefix + obj[key];
      if (obj.sourceRect) obj.sourceRect = toOriginalRect(obj.sourceRect,tile);
      if (obj.styles) {
        if (obj.styles.backgroundImageAssetId) obj.styles.backgroundImageAssetId = prefix + obj.styles.backgroundImageAssetId;
        for (const key of ['width','minWidth','maxWidth','fontSize','letterSpacing','gap','borderRadius']) {
          if (typeof obj.styles[key] === 'number') obj.styles[key] *= sx;
        }
        for (const key of ['height','minHeight','maxHeight']) if (typeof obj.styles[key] === 'number') obj.styles[key] *= sy;
        for (const key of ['padding','margin']) if (obj.styles[key]) {
          for (const side of ['top','right','bottom','left']) if (typeof obj.styles[key][side] === 'number') obj.styles[key][side] *= ['top','bottom'].includes(side) ? sy : sx;
        }
      }
      if (typeof obj.gap === 'number') obj.gap *= sx;
      for (const [key,value] of Object.entries(obj)) if (!['sourceRect','styles','meta'].includes(key)) transform(value);
    };
    transform(doc);
    if (doc.globals.spacing?.containerMaxWidth !== undefined) doc.globals.spacing.containerMaxWidth *= sx;
    if (doc.globals.typography.baseSize !== undefined) doc.globals.typography.baseSize *= sx;
    if (tile.totalTiles > 1 && doc.pages.some(p => p.sections.some(s => !s.sourceRect))) {
      throw new Error('Tall screenshot analysis requires section sourceRect bounds to reconcile tile overlaps');
    }
    return doc;
  });
  const result = docs[0];
  for (const doc of docs.slice(1)) {
    result.assets.push(...doc.assets);
    mergeNodes(result.pages[0].sections,doc.pages[0].sections,true);
  }
  // Geometric deduplication of repeated assets also rewrites every reference.
  const aliases = new Map<string,string>();
  result.assets = result.assets.filter((asset,index,all) => {
    const first = all.slice(0,index).find(other => other.type === asset.type && overlap(other.sourceRect,asset.sourceRect) > 0.85);
    if (first) { aliases.set(asset.id,aliases.get(first.id) || first.id); return false; }
    return true;
  });
  const rewrite = (value: any): void => {
    if (!value || typeof value !== 'object') return;
    for (const key of ['assetId','backgroundImageAssetId']) if (aliases.has(value[key])) value[key] = aliases.get(value[key]);
    Object.values(value).forEach(rewrite);
  };
  rewrite(result.pages);
  result.meta.sourceWidth = source.width;
  result.meta.sourceHeight = source.height;
  result.meta.sourceImageHash = source.sha256;
  result.meta.notes = [...(result.meta.notes || []), `Analyzed ${inputs.length} image tile(s); visual fidelity has not been rendered or measured.`];
  return result;
}
