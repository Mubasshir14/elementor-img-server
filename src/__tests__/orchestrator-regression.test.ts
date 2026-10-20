import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { computeContentHash } from '../modules/storage/image-processor.js';

const mocks = vi.hoisted(() => ({
  db: {conversionJob:{findUnique:vi.fn(),update:vi.fn()},asset:{findUnique:vi.fn(),create:vi.fn()},jobStage:{upsert:vi.fn()}},
  storage: {download:vi.fn(),upload:vi.fn()},
  ai: {execute:vi.fn(),isProviderAvailable:vi.fn(() => false),computeCacheKey:vi.fn(() => 'key'),invalidateCacheKey:vi.fn()},
}));
vi.mock('../lib/prisma.js',() => ({prisma:mocks.db}));
vi.mock('../modules/storage/factory.js',() => ({getStorage:() => mocks.storage}));
vi.mock('../modules/ai/router.js',() => ({getAIRouter:() => mocks.ai}));
import * as validator from '../modules/elementor/validator.js';
import { ConversionOrchestrator } from '../modules/conversion/orchestrator.js';

let bytes: Buffer;
let document: any;
beforeEach(async () => {
  vi.clearAllMocks();
  bytes=await sharp({create:{width:200,height:300,channels:3,background:'#386af4'}}).png().toBuffer();
  document={version:'1.0.0',meta:{sourceImageHash:'wrong-model-hash',sourceWidth:999,sourceHeight:999,
    analysisProvider:'wrong',analysisModel:'wrong',analysisTimestamp:'2026-10-20',confidenceScore:0.8,schemaVersion:'1.0.0',promptVersion:'test'},
    breakpoints:{desktop:{min:1024}},globals:{colors:{background:'#ffffff',text:'#111111'},typography:{fontFamilies:['Inter']}},assets:[],
    pages:[{id:'page',name:'Test',sections:[{id:'hero',role:'hero',confidence:0.8,styles:{},sourceRect:{x:0,y:0,width:200,height:300},
      children:[{id:'heading',kind:'heading',level:1,text:'Observed title',confidence:0.8,styles:{fontSize:38}}]}]}]};
  mocks.db.conversionJob.findUnique.mockResolvedValue({id:'job',projectId:'project',sourceAssetId:'source',attempts:1});
  mocks.db.asset.findUnique.mockResolvedValue({id:'source',storagePath:'original',sha256:computeContentHash(bytes),width:200,height:300,mimeType:'image/png'});
  mocks.db.conversionJob.update.mockResolvedValue({});mocks.db.jobStage.upsert.mockResolvedValue({});mocks.db.asset.create.mockResolvedValue({});
  mocks.storage.download.mockResolvedValue(bytes);
  mocks.storage.upload.mockImplementation(async (key:string,buffer:Buffer) => ({key,size:buffer.length,contentHash:computeContentHash(buffer)}));
  mocks.ai.execute.mockImplementation(async () => ({content:JSON.stringify(document),provider:'mock',model:'offline',usage:{inputTokens:1,outputTokens:1,totalTokens:2},latencyMs:1,finishReason:'STOP'}));
});
afterEach(() => vi.restoreAllMocks());
const readyWrites = () => mocks.db.conversionJob.update.mock.calls.filter(([args]) => args.data.status === 'preview_ready');

describe('Production orchestrator regression gates', () => {
  it('attaches validated image bytes, pins factual metadata, downloads once and reports fidelity unmeasured', async () => {
    await new ConversionOrchestrator().processJob('job');
    expect(mocks.storage.download).toHaveBeenCalledTimes(1);
    const request=mocks.ai.execute.mock.calls[0][0];
    expect(request.modelId).toBeUndefined(); // router owns model configuration
    const inline=request.messages[1].content.find((part:any) => part.type === 'image_url').image_url.url;
    expect((await sharp(Buffer.from(inline.split(',')[1],'base64')).metadata()).width).toBe(200);
    const ready=readyWrites()[0][0].data;
    expect(ready.dirArtifact.meta).toMatchObject({sourceWidth:200,sourceHeight:300,sourceImageHash:computeContentHash(bytes),analysisModel:'offline'});
    const quality=mocks.db.jobStage.upsert.mock.calls.find(([args]) => args.create.stage === 'elementor_validation')![0].create.outputPayload.qualityAudit;
    expect(quality.structuralValidity).toBe('passed');expect(quality.visualFidelity.status).toBe('not_measured');
    expect(ready.currentStage).toBe('elementor_validation');
  });
  it.each(['download','invalid bytes','hash mismatch','missing source'])('fails before calling AI for %s', async failure => {
    if(failure==='download') mocks.storage.download.mockRejectedValue(new Error('inaccessible'));
    if(failure==='invalid bytes') mocks.storage.download.mockResolvedValue(Buffer.from('invalid'));
    if(failure==='hash mismatch') mocks.db.asset.findUnique.mockResolvedValue({storagePath:'original',sha256:'wrong'});
    if(failure==='missing source') mocks.db.asset.findUnique.mockResolvedValue(null);
    await expect(new ConversionOrchestrator().processJob('job')).rejects.toThrow();
    expect(mocks.ai.execute).not.toHaveBeenCalled();expect(readyWrites()).toHaveLength(0);
    expect(mocks.db.conversionJob.update).toHaveBeenLastCalledWith(expect.objectContaining({data:expect.objectContaining({status:'failed'})}));
  });
  it.each(['length','MAX_TOKENS'])('rejects %s even if truncated output happens to parse as JSON', async finishReason => {
    mocks.ai.execute.mockResolvedValue({content:JSON.stringify(document),provider:'mock',model:'offline',usage:{inputTokens:1,outputTokens:1},latencyMs:1,finishReason});
    await expect(new ConversionOrchestrator().processJob('job')).rejects.toThrow('truncated');expect(readyWrites()).toHaveLength(0);
  });
  it.each(['provider failure','malformed JSON','invalid schema'])('never presents %s as a successful conversion', async failure => {
    if(failure==='provider failure') mocks.ai.execute.mockRejectedValue(new Error('Vision unavailable'));
    if(failure==='malformed JSON') mocks.ai.execute.mockResolvedValue({content:'{broken',provider:'mock',model:'offline',usage:{inputTokens:1,outputTokens:1},latencyMs:1});
    if(failure==='invalid schema') document.pages[0].sections[0].children[0].styles.madeUp=123;
    await expect(new ConversionOrchestrator().processJob('job')).rejects.toThrow();expect(readyWrites()).toHaveLength(0);
  });
  it('does not persist a ready artifact when Elementor schema validation fails', async () => {
    vi.spyOn(validator,'validateElementor').mockReturnValue({valid:false,errors:[{path:'content',message:'Invalid widget',code:'INVALID'}],warnings:[],stats:{totalElements:0,containers:0,widgets:0,widgetTypeCounts:{},maxDepth:0}});
    await expect(new ConversionOrchestrator().processJob('job')).rejects.toThrow('compilation failed validation');
    expect(readyWrites()).toHaveLength(0);
    expect(mocks.storage.upload).not.toHaveBeenCalled();
  });
  it('extracts original image pixels and retains the corresponding image reference', async () => {
    document.assets=[{id:'photo',type:'image',role:'photo',confidence:0.8,sourceRect:{x:20,y:30,width:80,height:90}}];
    document.pages[0].sections[0].children.push({id:'image',kind:'image',assetId:'photo',confidence:0.8,styles:{width:80,height:90},objectFit:'contain'});
    await new ConversionOrchestrator().processJob('job');
    expect(mocks.storage.download).toHaveBeenCalledTimes(1);
    const ready=readyWrites()[0][0].data;
    const media=ready.elementorArtifact.content[0].elements[1].settings.image;
    const cropped=await sharp(Buffer.from(media.url.split(',')[1],'base64')).metadata();
    expect([cropped.width,cropped.height]).toEqual([80,90]);expect(media.id).toBe('');
  });
  it('fails missing image bounds instead of generating a fake SVG image', async () => {
    document.assets=[{id:'photo',type:'image',role:'photo',confidence:0.8}];
    document.pages[0].sections[0].children.push({id:'image',kind:'image',assetId:'photo',confidence:0.8,styles:{}});
    await expect(new ConversionOrchestrator().processJob('job')).rejects.toThrow('no usable source crop');expect(readyWrites()).toHaveLength(0);
  });
  it('preserves a valid measured header group rather than inventing three slots', async () => {
    document.pages[0].sections[0].role='header';
    document.pages[0].sections[0].styles.flexDirection='row';
    await new ConversionOrchestrator().processJob('job');
    expect(readyWrites()[0][0].data.elementorArtifact.content[0].elements).toHaveLength(1);
  });
});
