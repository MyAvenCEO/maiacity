// @ts-nocheck — renderer mock, executed by bun:test
import { expect, test } from 'bun:test';
import { Texture } from 'three';
import { createPipeline } from './pipeline.js';

test('live frames preserve the canvas backing store until size or pixel ratio changes', () => {
 let width=960,height=540,ratio=1,resizes=0,draws=0;
 const renderer={capabilities:{maxSamples:4},extensions:{has:()=>true},autoClear:true,
 getPixelRatio:()=>ratio,setPixelRatio:r=>{ratio=r;resizes++;},getSize:v=>v.set(width,height),
 setSize:(w,h)=>{width=w;height=h;resizes++;},setViewport:()=>{},setRenderTarget:()=>{},render:()=>draws++};
 const pipe=createPipeline(renderer),frame=new Texture();
 for(let i=0;i<60;i++)pipe.view(frame,960,540,1,1,{});
 expect(draws).toBe(60);expect(resizes).toBe(0);
 pipe.view(frame,1280,720,1,1,{});expect(resizes).toBe(1);
 ratio=2;pipe.view(frame,1280,720,1,1,{});expect(resizes).toBe(2);
 pipe.view(frame,1280,720,1,1,{});expect(resizes).toBe(2);
});
