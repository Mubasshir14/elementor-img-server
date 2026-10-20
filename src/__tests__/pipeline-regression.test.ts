import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { computeContentHash, createTiles, validateImage } from '../modules/storage/image-processor.js';
import { loadSourceImage, resolveInlineImage } from '../modules/storage/image-input.js';
import { mergeTileDocuments, prepareAnalysisImages, toOriginalRect, type AnalysisTile } from '../modules/conversion/preprocessing.js';
import { convertDIRToElementor } from '../modules/elementor/generator.js';
import { validateElementor } from '../modules/elementor/validator.js';
import { validateDIR } from '../modules/dir/schema.js';
import { normalizeDIR } from '../modules/dir/normalizer.js';
import { auditCorrespondence } from '../modules/conversion/structural-audit.js';
import { GeminiAdapter } from '../modules/ai/providers/gemini.js';
import type { DIRDocument } from '../modules/dir/types.js';
import type { StorageAdapter } from '../modules/storage/types.js';

const image = (format: 'png'|'jpeg'|'webp' = 'png', width = 200, height = 300) => sharp({
  create: { width, height, channels: 3, background: '#386af4' },
})[format]().toBuffer();
const heading = (id = 'heading', size = 38): any => ({ id, kind: 'heading', level: 1, text: id,
  confidence: 0.8, styles: {fontSize: size}, sourceRect: {x: 10,y: 20,width: 100,height: 45} });
function dir(): DIRDocument {
  return { version: '1.0.0', meta: { sourceImageHash: 'test-hash', sourceWidth: 200,sourceHeight: 300,
    analysisProvider: 'mock',analysisModel: 'test',analysisTimestamp: '2026-10-20T00:00:00Z',
    confidenceScore: 0.8,schemaVersion: '1.0.0',promptVersion: 'test' },
    breakpoints: {desktop:{min:1024}}, globals:{colors:{background:'#ffffff',text:'#111111'},typography:{fontFamilies:['Inter']}},
    assets:[],pages:[{id:'page',name:'Fixture',sections:[{id:'hero',role:'hero',confidence:0.8,styles:{},
      sourceRect:{x:0,y:0,width:200,height:300},children:[heading()]}]}] };
}
function storage(buffer: Buffer): StorageAdapter {
  return { download: vi.fn().mockResolvedValue(buffer),upload:vi.fn(),delete:vi.fn(),getSignedUrl:vi.fn(),exists:vi.fn() };
}
afterEach(() => {vi.unstubAllGlobals();vi.useRealTimers();vi.restoreAllMocks();});

describe('Source image content, retrieval and provider attachment', () => {
  it.each(['png','jpeg','webp'] as const)('validates and attaches actual %s bytes with detected MIME', async format => {
    const buffer = await image(format);
    const metadata = await validateImage(buffer);
    expect(metadata.mimeType).toBe(`image/${format}`);
    const source = await loadSourceImage(storage(buffer),{storagePath:'original',sha256:computeContentHash(buffer),width:200,height:300},100);
    expect(source.sha256).toBe(computeContentHash(buffer));
    const inline = await resolveInlineImage(`data:${metadata.mimeType};base64,${buffer.toString('base64')}`,100);
    expect(Buffer.from(inline.data,'base64')).toEqual(buffer);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{}'}]},finishReason:'STOP'}]})));
    vi.stubGlobal('fetch',fetcher);
    await new GeminiAdapter({apiKey:'offline',defaultModel:'gemini-3.8-flash'}).sendRequest({role:'vision',messages:[{role:'user',content:[{type:'image_url',image_url:{url:`data:${metadata.mimeType};base64,${inline.data}`}}]}]});
    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(payload.contents[0].parts[0].inlineData).toEqual(inline);
  });
  it('rejects corrupt pixel data even when a valid header remains', async () => {
    const buffer = await image();
    await expect(validateImage(buffer.subarray(0,Math.floor(buffer.length/2)))).rejects.toThrow();
  });
  it('rejects spoofed MIME and malformed data URIs', async () => {
    const buffer = await image('webp');
    await expect(resolveInlineImage(`data:image/png;base64,${buffer.toString('base64')}`,100)).rejects.toThrow('MIME');
    await expect(resolveInlineImage('data:image/png;base64,abcd=',100)).rejects.toThrow('base64');
  });
  it('rejects missing, expired, inaccessible and swapped sources', async () => {
    const buffer = await image();
    await expect(loadSourceImage(storage(buffer),null,100)).rejects.toThrow('missing');
    const inaccessible = storage(buffer);vi.mocked(inaccessible.download).mockRejectedValue(new Error('secret signed URL'));
    await expect(loadSourceImage(inaccessible,{storagePath:'key',sha256:'hash'},100)).rejects.toThrow('could not be retrieved');
    await expect(loadSourceImage(storage(buffer),{storagePath:'key',sha256:'wrong-hash'},100)).rejects.toThrow('integrity mismatch');
    await expect(loadSourceImage(storage(buffer),{storagePath:'key',sha256:computeContentHash(buffer),width:999},100)).rejects.toThrow('dimensions');
  });
  it('bounds stalled storage and HTTP image retrieval without leaking signed URLs', async () => {
    const stalled = storage(Buffer.alloc(0));vi.mocked(stalled.download).mockReturnValue(new Promise(() => {}));
    await expect(loadSourceImage(stalled,{storagePath:'key',sha256:'hash'},10)).rejects.toThrow('timed out');
    vi.stubGlobal('fetch',vi.fn(() => new Promise(() => {})));
    await expect(resolveInlineImage('https://example.com/image?secret=private',10)).rejects.toThrow('timed out');
  });
  it.each([403,404,500])('reports HTTP %s retrieval failure without exposing query credentials', async status => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status})));
    await expect(resolveInlineImage('https://example.com/image?token=secret',100)).rejects.toThrow(`HTTP ${status}`);
  });
  it('rejects an HTML download and detects a WebP file independently of HTTP headers', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('<html>expired</html>')).mockResolvedValueOnce(new Response(new Uint8Array(await image('webp')),{headers:{'content-type':'image/png'}})));
    await expect(resolveInlineImage('https://example.com/image',100)).rejects.toThrow();
    expect((await resolveInlineImage('https://example.com/image',100)).mimeType).toBe('image/webp');
  });
  it('honors adapter model options rather than replacing them with environment defaults', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{}'}]}}]})));
    vi.stubGlobal('fetch',fetcher);
    const model = 'gemini-3.8-flash';
    await new GeminiAdapter({apiKey:'offline',defaultModel:model}).sendRequest({role:'structure',messages:[{role:'user',content:'JSON'}]});
    expect(fetcher.mock.calls[0][0]).toContain(`/models/${model}:generateContent`);
  });
});

describe('Lossless preprocessing and original coordinate mapping', () => {
  const tile: AnalysisTile = {buffer:Buffer.alloc(0),mimeType:'image/png',width:100,height:100,originalWidth:200,originalHeight:200,yOffset:180,index:1,totalTiles:2};
  it('maps resized tile bounds using independent scales and the original offset', () => {
    expect(toOriginalRect({x:5,y:10,width:20,height:30},tile)).toEqual({x:10,y:200,width:40,height:60});
    expect(() => toOriginalRect({x:90,y:10,width:20,height:30},tile)).toThrow('outside');
  });
  it('creates overlapping vertical tiles without changing the source image', async () => {
    const buffer = await image('png',200,5000);const hash = computeContentHash(buffer);
    const prepared = await prepareAnalysisImages({...await validateImage(buffer),buffer,sha256:hash});
    expect(prepared.map(t => t.yOffset)).toEqual([0,2000,4000]);
    expect(prepared.map(t => t.originalHeight)).toEqual([2400,2400,1000]);
    expect(computeContentHash(buffer)).toBe(hash);
    expect(prepared.every(t => t.width === 200 && t.mimeType === 'image/png')).toBe(true);
    await expect(createTiles(buffer,100,100)).rejects.toThrow('overlap');
  });
  it('reconciles duplicate overlapping detections and namespaces IDs and asset references', async () => {
    const buffer = await image('png',200,400);const source = {...await validateImage(buffer),buffer,sha256:computeContentHash(buffer)};
    const first = dir();first.pages[0].sections[0].sourceRect = {x:0,y:160,width:200,height:80};
    first.pages[0].sections[0].children[0].sourceRect = {x:10,y:185,width:100,height:30};
    const second = structuredClone(first);second.pages[0].sections[0].sourceRect!.y = 0;second.pages[0].sections[0].sourceRect!.height=60;
    second.pages[0].sections[0].children[0].sourceRect!.y=5;
    const tile0 = {...tile,index:0,yOffset:0,width:200,height:240,originalWidth:200,originalHeight:240};
    const tile1 = {...tile,width:200,height:220,originalWidth:200,originalHeight:220};
    const result = mergeTileDocuments([{document:first,tile:tile0},{document:second,tile:tile1}],source);
    expect(result.pages[0].sections).toHaveLength(1);
    expect(result.pages[0].sections[0].children).toHaveLength(1);
    expect(result.pages[0].sections[0].sourceRect).toEqual({x:0,y:160,width:200,height:80});
    expect(result.meta.sourceHeight).toBe(400);
    expect(validateDIR(result).valid).toBe(true);
  });
  it('maps image and background references to deduplicated overlapping assets', async () => {
    const buffer=await image('png',200,400);const source={...await validateImage(buffer),buffer,sha256:computeContentHash(buffer)};
    const first=dir();first.pages[0].sections[0].sourceRect={x:0,y:160,width:200,height:80};
    first.pages[0].sections[0].children[0].sourceRect={x:10,y:185,width:100,height:30};
    first.assets=[{id:'photo',type:'background',role:'background',confidence:0.8,sourceRect:{x:10,y:185,width:100,height:30}}];
    first.pages[0].sections[0].styles.backgroundImageAssetId='photo';
    const second=structuredClone(first);second.pages[0].sections[0].sourceRect!.y=0;
    second.pages[0].sections[0].sourceRect!.height=60;second.pages[0].sections[0].children[0].sourceRect!.y=5;second.assets[0].sourceRect!.y=5;
    const t0={...tile,index:0,yOffset:0,width:200,height:240,originalWidth:200,originalHeight:240};
    const t1={...tile,width:200,height:220,originalWidth:200,originalHeight:220};
    const merged=mergeTileDocuments([{document:first,tile:t0},{document:second,tile:t1}],source);
    expect(merged.assets).toHaveLength(1);
    expect(merged.pages[0].sections[0].styles.backgroundImageAssetId).toBe(merged.assets[0].id);
    expect(merged.assets[0].sourceRect).toEqual({x:10,y:185,width:100,height:30});
  });
  it('fails ambiguous tiled section output without geometric evidence', async () => {
    const document = dir();delete document.pages[0].sections[0].sourceRect;
    const buffer=await image();
    expect(() => mergeTileDocuments([{document,tile:{...tile,width:200,height:300,originalWidth:200,originalHeight:300}}],{...{width:200,height:300,format:'png',mimeType:'image/png',size:buffer.length},buffer,sha256:'hash'})).toThrow('requires section');
  });
});

describe('Compiler hierarchy, responsive settings and truthful structural reporting', () => {
  it.each(['two-column hero','three-column grid','header navigation','full-width background','nested alignment','image-heavy page','responsive arrangement'])('preserves %s deterministically', name => {
    const document = dir();const section=document.pages[0].sections[0];
    const group:any = {id:'group',kind:name.includes('grid')?'grid-group':'container',columns:3,direction:'row',confidence:0.8,
      sourceRect:{x:0,y:0,width:200,height:300},styles:{gap:18,alignItems:'center',padding:{left:12,right:12}},children:[]};
    // Canonical container fields depend on kind.
    if(group.kind==='container') delete group.columns; else delete group.direction;
    for(let i=0;i<(name.includes('grid')?3:2);i++) group.children.push({id:`col${i}`,kind:'container',direction:'column',confidence:0.8,styles:{width:i===0?'35%':'60%'},children:[heading(`h${i}`)]});
    if(name.includes('header')) section.role='header';
    if(name.includes('background')) section.styles={width:'100%',backgroundColor:'#334455',minHeight:900};
    if(name.includes('image')) {
      document.assets=[{id:'a',type:'image',role:'photo',confidence:0.8,url:'https://example.com/photo.png'}];
      group.children[1].children=[{id:'photo',kind:'image',assetId:'a',confidence:0.8,objectFit:'contain',styles:{width:92,height:88}}];
    }
    if(name.includes('responsive')) group.responsiveOverrides={mobile:{flexDirection:'row',width:'72%',gap:0},tablet:{flexDirection:'column'}};
    section.children=[group];
    const before=JSON.stringify(document);
    const compiled=convertDIRToElementor(document),again=convertDIRToElementor(document);
    expect(JSON.stringify(document)).toBe(before);
    expect(compiled.document).toEqual(again.document);
    expect(validateElementor(compiled.document).valid).toBe(true);
    expect(auditCorrespondence(document,compiled.document,compiled.report.nodeElementIds!)).toEqual([]);
    const root=compiled.document.content[0],row=root.elements[0];
    expect(row.elements).toHaveLength(group.children.length);
    expect(row.elements[0].settings.width).toEqual({unit:'%',size:35});
    if(name.includes('responsive')) {
      expect(row.settings.flex_direction_mobile).toBe('row');expect(row.settings.width_mobile).toEqual({unit:'%',size:72});
      expect(row.settings.flex_gap_mobile).toEqual({unit:'px',size:0});
    } else expect(row.settings.flex_direction_mobile).toBeUndefined();
    if(name.includes('image')) expect(row.elements[1].elements[0].settings.width).toEqual({unit:'px',size:92});
    if(name.includes('background')) expect(root.settings.min_height.size).toBe(900);
  });
  it('does not let an unrelated heading satisfy another node typography check', () => {
    const document=dir();document.pages[0].sections[0].children.push(heading('other',24));
    const result=convertDIRToElementor(document);
    result.document.content[0].elements[0].settings.typography_font_size.size=12;
    expect(auditCorrespondence(document,result.document,result.report.nodeElementIds!)).toEqual(["Typography size differs at 'heading': expected 38"]);
  });
  it('rejects missing assets instead of using another image or fabricating a placeholder', () => {
    const document=dir();document.assets=[{id:'unrelated',type:'image',role:'other',confidence:1,url:'https://example.com/other.png'}];
    document.pages[0].sections[0].children=[{id:'missing',kind:'image',assetId:'missing',confidence:0.8,styles:{}}];
    expect(() => convertDIRToElementor(document)).toThrow('no resolved asset');
  });
  it('preserves observed bounds and uncertainty through schema normalization', () => {
    const document=dir();const section=document.pages[0].sections[0];
    section.observedProperties=['layout'];section.inferredProperties=['fontFamily'];section.uncertainty=['font unavailable'];
    const result=validateDIR(normalizeDIR(document));
    expect(result.valid).toBe(true);expect(result.document?.pages[0].sections[0]).toMatchObject(section);
    (document.pages[0].sections[0].children[0] as any).styles.madeUpProperty=1;
    expect(validateDIR(document).valid).toBe(false);
  });
  it.each(['image-box','testimonial','gallery','image-gallery','toggle'])('accepts and compiles the existing %s widget contract', kind => {
    const document=dir();document.assets=[{id:'media',type:'image',role:'photo',confidence:0.8,url:'https://example.com/photo.png'}];
    const node:any={id:'specialized',kind,confidence:0.8,styles:{}};
    if(kind==='gallery' || kind==='image-gallery') node.images=[{assetId:'media'}];
    else if(kind==='toggle') node.items=[{title:'Observed question',children:[{id:'answer',kind:'text',html:'Observed answer',confidence:0.8,styles:{}}]}];
    else {node.assetId='media';if(kind==='image-box')node.title='Observed title';else node.content='Observed quote';}
    document.pages[0].sections[0].children=[node];
    const validated=validateDIR(normalizeDIR(document));expect(validated.valid).toBe(true);
    const compiled=convertDIRToElementor(validated.document!);expect(validateElementor(compiled.document).valid).toBe(true);
    const widget=compiled.document.content[0].elements[0];
    expect(widget.widgetType).toBe(kind==='gallery'?'image-gallery':kind);
    if(kind==='image-box') expect(widget.settings.link).toBeUndefined();
  });
  it('rejects unknown widget types, widget children and malformed settings', () => {
    expect(validateElementor({content:[{id:'1234567',elType:'widget',widgetType:'imaginary',settings:[],elements:[{}]}]}).valid).toBe(false);
  });
});
