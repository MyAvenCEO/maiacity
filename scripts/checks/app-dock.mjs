import puppeteer from 'puppeteer-core';
import {readFileSync}from'node:fs';
const css=readFileSync('src/app.css','utf8');const start=css.indexOf('.app-dock {'),end=css.indexOf('/* Where the joystick',start);
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{const page=await browser.newPage();for(const [width,height]of[[390,844],[320,568],[1024,768]]){
await page.setViewport({width,height});await page.setContent(`<style>:root{--nav-foot:14px}*{box-sizing:border-box}${css.slice(start,end)}.card{background:white;width:100%;padding:12px;border:1px solid gray}.nav{height:64px;width:180px;flex-shrink:0;background:green}</style><div class=app-dock><div class=foot-stack><div class=card style="order:0">Checking this view<br>Background · syncing 2,847 logs</div><div class=card style="order:20;height:140px">Information</div><div class=card style="order:30;height:250px">Profile menu</div></div><nav class=nav></nav></div>`);
const result=await page.evaluate(()=>{const stack=document.querySelector('.foot-stack').getBoundingClientRect(),nav=document.querySelector('nav').getBoundingClientRect(),dock=document.querySelector('.app-dock').getBoundingClientRect();return{valid:stack.bottom<=nav.top&&nav.bottom<=innerHeight&&dock.top>=0&&dock.left>=0&&dock.right<=innerWidth,stack:stack.toJSON(),nav:nav.toJSON()}});if(!result.valid)throw Error(JSON.stringify(result));console.log(`PASS ${width}x${height}: stack above nav and inside viewport`);
}}finally{await browser.close()}
