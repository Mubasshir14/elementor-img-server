import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import sharp from 'sharp';
const mocks=vi.hoisted(() => ({db:{project:{create:vi.fn(),findFirst:vi.fn()},user:{findUnique:vi.fn(),update:vi.fn()},asset:{create:vi.fn(),findUnique:vi.fn()},conversionJob:{create:vi.fn(),findUnique:vi.fn(),update:vi.fn()}},storage:{upload:vi.fn(),download:vi.fn()}}));
vi.mock('../lib/prisma.js',() => ({prisma:mocks.db}));
vi.mock('../modules/storage/factory.js',() => ({getStorage:() => mocks.storage}));
vi.mock('../middleware/auth.js',() => ({requireAuth:(req:any,_res:any,next:any) => {req.user={id:'user',userId:'user'};next();}}));
import {uploadRouter} from '../routes/upload.js';
import {jobsRouter} from '../routes/jobs.js';
let server:Server,base:string;
beforeAll(async () => {
 const app=express();app.use(express.json());app.set('json replacer',(_key:string,value:unknown) => typeof value==='bigint'?value.toString():value);
 app.use('/upload',uploadRouter);app.use('/jobs',jobsRouter);
 app.use((error:any,_req:any,res:any,_next:any) => res.status(error.statusCode || 500).json({success:false,error:{message:error.message}}));
 await new Promise<void>(resolve => {server=app.listen(0,'127.0.0.1',() => {base=`http://127.0.0.1:${(server.address() as any).port}`;resolve();});});
});
afterAll(async () => {await new Promise<void>((resolve,reject) => server.close(error => error?reject(error):resolve()));});
beforeEach(() => {
 vi.clearAllMocks();
 mocks.db.project.create.mockResolvedValue({id:'project'});mocks.db.user.findUnique.mockResolvedValue({usedStorage:0n});mocks.db.user.update.mockResolvedValue({});
 mocks.db.asset.create.mockImplementation(async ({data}:any) => ({id:'source',...data}));
 mocks.storage.upload.mockImplementation(async (key:string,buffer:Buffer) => ({key,size:buffer.length,contentHash:'hash'}));
 mocks.db.conversionJob.create.mockResolvedValue({id:'job',projectId:'project',sourceAssetId:'source',status:'queued'});
 mocks.db.conversionJob.findUnique.mockResolvedValue({id:'job',projectId:'project',sourceAssetId:'source',project:{userId:'user'},status:'queued'});
});
describe('HTTP upload and job contract without a database or AI',() => {
 it.each(['png','jpeg','webp'] as const)('accepts %s end to end and returns the queued source/job association',async format => {
  const bytes=await sharp({create:{width:24,height:32,channels:3,background:'blue'}})[format]().toBuffer();
  const form=new FormData();form.append('image',new Blob([new Uint8Array(bytes)],{type:`image/${format}`}),`image.${format}`);form.append('name','Landing');
  const response=await fetch(`${base}/upload`,{method:'POST',body:form});const body=await response.json() as any;
  expect(response.status).toBe(201);expect(body.success).toBe(true);
  expect(body.data.job).toMatchObject({status:'queued',sourceAssetId:body.data.asset.id,projectId:body.data.project.id});
  expect(body.data.asset).toMatchObject({mimeType:`image/${format}`,width:24,height:32});
 });
 it('rejects invalid pixel content instead of enqueuing a conversion',async () => {
  const form=new FormData();form.append('image',new Blob(['not an image'],{type:'image/png'}),'image.png');
  const response=await fetch(`${base}/upload`,{method:'POST',body:form});expect(response.status).toBe(400);
  expect(mocks.db.conversionJob.create).not.toHaveBeenCalled();expect(mocks.storage.upload).not.toHaveBeenCalled();
 });
 it('returns only the screenshot linked to the authorized job',async () => {
  const bytes=await sharp({create:{width:24,height:32,channels:3,background:'blue'}}).png().toBuffer();
  mocks.db.asset.findUnique.mockResolvedValue({id:'source',projectId:'project',storagePath:'original',mimeType:'image/png'});mocks.storage.download.mockResolvedValue(bytes);
  const response=await fetch(`${base}/jobs/job/source`);expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);expect(mocks.storage.download).toHaveBeenCalledWith('original');
 });
 it('rejects another owner before downloading a screenshot',async () => {
  mocks.db.conversionJob.findUnique.mockResolvedValue({id:'job',projectId:'project',sourceAssetId:'source',project:{userId:'other'}});
  const response=await fetch(`${base}/jobs/job/source`);expect(response.status).toBe(404);expect(mocks.storage.download).not.toHaveBeenCalled();
 });
 it('does not retry an actively queued or processing job',async () => {
  const response=await fetch(`${base}/jobs/job/retry`,{method:'POST'});expect(response.status).toBe(400);expect(mocks.db.conversionJob.update).not.toHaveBeenCalled();
 });
});
