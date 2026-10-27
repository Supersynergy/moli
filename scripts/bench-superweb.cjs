#!/usr/bin/env node
// Local fixtures only. PLAYWRIGHT_MODULE may point to an existing installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const {spawn, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const exec = promisify(execFile);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i < 0 ? d : process.argv[i + 1]; };
const out = path.resolve(arg('--out', 'target/superweb-bench'));
const moli = arg('--moli', 'moli');
const engines = arg('--engines', 'moli,chromium').split(',');
assert.ok(engines.length && engines.every(e => ['moli','chromium'].includes(e)), 'engines: moli,chromium');
fs.mkdirSync(out, {recursive:true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const html = `<!doctype html><meta charset="utf-8"><title>Benchmark</title>
<style>input,button{padding:12px;margin:12px}#source,#drop{display:inline-block;width:140px;height:80px;margin:20px;background:#cdf}.long{height:1600px}</style>
<input id="name" aria-label="Name"><button id="save">Save</button><p id="result">Ready</p><div id="late"></div>
<input id="upload" type="file"><div id="source" draggable="true">Drag</div><div id="drop">Drop</div><iframe src="/frame"></iframe><div class="long"></div><button id="bottom">Bottom</button>
<script>window.trusted=[];window.drag=[];document.querySelector('#name').oninput=e=>trusted.push(e.isTrusted);
document.querySelector('#save').onclick=async e=>{trusted.push(e.isTrusted);let name=document.querySelector('#name').value;let r=await(await fetch('/api?name='+encodeURIComponent(name))).json();document.querySelector('#result').textContent=r.saved;
let b=document.createElement('button');b.id='dynamic';b.textContent='Dynamic';b.onclick=e=>{trusted.push(e.isTrusted);document.title='Done';};document.querySelector('#late').replaceChildren(b);};
document.querySelector('#source').ondragstart=e=>{drag.push('start');e.dataTransfer.setData('text/plain','payload');};
document.querySelector('#source').ondragend=e=>drag.push('end');document.querySelector('#drop').ondragover=e=>e.preventDefault();document.querySelector('#drop').ondrop=e=>{e.preventDefault();drag.push(e.dataTransfer.getData('text/plain'));};
if(document.modelContext)document.modelContext.registerTool({name:'echo',description:'echo',inputSchema:{type:'object'},execute:a=>a.text});</script>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if(u.pathname==='/api'){res.setHeader('content-type','application/json');res.end(JSON.stringify({saved:u.searchParams.get('name')}));}
  else if(u.pathname==='/frame'){res.setHeader('content-type','text/html');res.end('<button id="inside" onclick="document.title=\'Frame clicked\'">Inside</button>');}
  else {res.setHeader('content-type','text/html');res.end(html);}
});
let url, launches=0;
const active = new Set();
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function rss(pid){const {stdout}=await exec('ps',['-axo','pid,ppid,rss'],{timeout:3000});const rows=stdout.trim().split('\n').slice(1).map(l=>l.trim().split(/\s+/).map(Number));const ids=new Set([pid]);let added=true;while(added){added=false;for(const [id,parent] of rows)if(ids.has(parent)&&!ids.has(id)){ids.add(id);added=true;}}return rows.reduce((sum,[id,,kb])=>sum+(ids.has(id)?kb:0),0);}
async function launch(engine, profile){
  if(engine==='chromium'){const host=await chromium.launchServer({headless:true});const browser=await chromium.connect(host.wsEndpoint());const handle={engine,browser,pid:host.process().pid,stop:async()=>{await browser.close();await host.close();active.delete(handle);}};active.add(handle);return handle;}
  const p=await port();const fd=fs.openSync(path.join(out,`moli-${++launches}.log`),'w');const child=spawn(moli,['serve','--host','127.0.0.1','--port',String(p),'--layout','--screencast-interval-ms','100',...(profile?['--profile-dir',profile]:[])],{stdio:['ignore',fd,fd]});fs.closeSync(fd);
  const handle={engine,pid:child.pid,browser:null,stop:async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');for(let i=0;i<65&&child.exitCode===null&&child.signalCode===null;i++)await sleep(100);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await new Promise(r=>child.once('exit',r));throw Error('Moli shutdown exceeded 6.5s');}}if(handle.browser)await handle.browser.close();active.delete(handle);}};active.add(handle);
  for(let i=0;i<100;i++){assert.equal(child.exitCode,null,'Moli exited before ready');try{if((await fetch(`http://127.0.0.1:${p}/json/version`)).ok)break;}catch(error){if(child.exitCode!==null)throw error;}await sleep(40);}
  handle.browser=await chromium.connectOverCDP(`http://127.0.0.1:${p}`,{timeout:5000});return handle;
}
async function pageFor(h){const context=h.engine==='moli'?h.browser.contexts()[0]:await h.browser.newContext();const page=await context.newPage();page.setDefaultTimeout(3500);return page;}
async function workflow(page){await page.goto(url,{waitUntil:'domcontentloaded'});await page.getByRole('textbox',{name:'Name'}).fill('Ada');await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#result').textContent==='Ada');const layout=await page.context().newCDPSession(page);try{await layout.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:1,height:1,scale:1}});}finally{await layout.detach();}await page.locator('#dynamic').click();assert.equal(await page.title(),'Done');assert.ok(await page.evaluate(()=>window.trusted.length>=2&&window.trusted.every(Boolean)));}
async function capability(name, fn, results){const t=performance.now();try{const detail=await fn();results.push({name,pass:true,ms:+(performance.now()-t).toFixed(2),detail:detail??null});}catch(e){results.push({name,pass:false,ms:+(performance.now()-t).toFixed(2),error:e.message.slice(0,700)});}}
async function matrix(engine){const h=await launch(engine),page=await pageFor(h),checks=[];await page.goto(url);
  try{
    await capability('trusted_form_xhr_dynamic_click',()=>workflow(page),checks);
    await capability('raw_dynamic_geometry',async()=>{const r=await page.evaluate(()=>{let b=document.createElement('button');b.id='raw';b.textContent='Fresh';document.body.prepend(b);let r=b.getBoundingClientRect();return {width:r.width,height:r.height};});assert.ok(r.width>0&&r.height>0,JSON.stringify(r));return r;},checks);
    await capability('layout_refresh_via_dom_geometry',async()=>{const r=await page.locator('#raw').boundingBox();assert.ok(r?.width>0);return r;},checks);
    await capability('file_upload',async()=>{const file=path.join(out,'upload.txt');fs.writeFileSync(file,'fixture upload');await page.locator('#upload').setInputFiles(file);assert.equal(await page.evaluate(()=>document.querySelector('#upload').files[0].name),'upload.txt');},checks);
    await capability('html_drag_to_with_dragend',async()=>{await page.locator('#source').dragTo(page.locator('#drop'));assert.deepEqual(await page.evaluate(()=>window.drag),['start','payload','end']);},checks);
    await capability('iframe_locator',async()=>{await page.frameLocator('iframe').locator('#inside').click();assert.equal(await page.frames()[1].title(),'Frame clicked');},checks);
    await capability('history_back',async()=>{await page.goto(url+'next');await page.goBack();assert.equal(page.url(),url);},checks);
    await capability('wheel_scroll',async()=>{await page.mouse.wheel(0,600);await page.waitForFunction(()=>scrollY>0);assert.ok(await page.evaluate(()=>scrollY>0));},checks);
    await capability('cookie_storage_isolation',async()=>{await page.evaluate(()=>{document.cookie='isolated=main; Max-Age=3600; Path=/';localStorage.setItem('isolation','main');});const c=await h.browser.newContext();try{const p=await c.newPage();await p.goto(url);assert.deepEqual(await p.evaluate(()=>[document.cookie,localStorage.getItem('isolation')]),['',null]);}finally{await c.close();}},checks);
    await capability('network_route',async()=>{await page.route('**/api*',r=>r.fulfill({contentType:'application/json',body:'{"saved":"routed"}'}));assert.equal(await page.evaluate(async()=> (await(await fetch('/api')).json()).saved),'routed');await page.unroute('**/api*');},checks);
    await capability('screenshot_png',async()=>{const b=await page.screenshot({path:path.join(out,engine+'.png')});assert.equal(b.subarray(1,4).toString(),'PNG');},checks);
    await capability('pdf',async()=>{const b=await page.pdf({path:path.join(out,engine+'.pdf')});assert.equal(b.subarray(0,4).toString(),'%PDF');const text=(await exec('pdftotext',[path.join(out,engine+'.pdf'),'-'],{timeout:5000})).stdout;assert.match(text,/Save/);},checks);
    await capability('canvas_2d_webgl',async()=>{const r=await page.evaluate(()=>{const a=document.createElement('canvas'),b=document.createElement('canvas');return {twoD:!!a.getContext('2d'),webGL:!!b.getContext('webgl')};});assert.ok(r.twoD&&r.webGL,JSON.stringify(r));return r;},checks);
    await capability('playwright_trace',async()=>{await page.context().tracing.start({screenshots:true,snapshots:true,sources:true});await page.goto(url);await page.context().tracing.stop({path:path.join(out,engine+'-trace.zip')});assert.ok(fs.statSync(path.join(out,engine+'-trace.zip')).size>100);},checks);
    await capability('cdp_screencast',async()=>{const c=await page.context().newCDPSession(page);let count=0;const onFrame=e=>{count++;c.send('Page.screencastFrameAck',{sessionId:e.sessionId}).catch(()=>{});};c.on('Page.screencastFrame',onFrame);try{await c.send('Page.startScreencast',{format:'jpeg'});for(let i=0;i<4;i++){await page.evaluate(i=>{document.body.style.background=i%2?'red':'blue';},i);await sleep(150);}assert.ok(count>=2,'frames='+count);return {frames:count};}finally{await c.send('Page.stopScreencast');c.off('Page.screencastFrame',onFrame);await c.detach();}},checks);
    await capability('native_webmcp',async()=>{const c=await page.context().newCDPSession(page);try{const tools=new Promise(resolve=>c.once('WebMCP.toolsAdded',resolve));await c.send('WebMCP.enable');const catalog=await Promise.race([tools,sleep(2500).then(()=>{throw Error('catalog timeout');})]);const tool=catalog.tools.find(t=>t.name==='echo');assert.ok(tool);const responded=new Promise(resolve=>c.once('WebMCP.toolResponded',resolve));const id=await c.send('WebMCP.invokeTool',{frameId:tool.frameId,toolName:'echo',input:{text:'native'}});const r=await Promise.race([responded,sleep(2500).then(()=>{throw Error('response timeout');})]);assert.equal(r.invocationId,id.invocationId);assert.equal(r.output,'native');}finally{await c.detach();}},checks);
  }finally{await h.stop();}
  if(engine==='moli')await capability('profile_restart_with_open_cdp',async()=>{const profile=fs.mkdtempSync(path.join(os.tmpdir(),'moli-bench-profile-'));try{let first=await launch(engine,profile);try{const p=await pageFor(first);await p.goto(url);await p.evaluate(()=>{document.cookie='persist=kept; Path=/; Max-Age=3600';localStorage.setItem('persist','kept');});assert.match(await p.evaluate(()=>document.cookie),/persist=kept/);}finally{await first.stop();}let second=await launch(engine,profile);try{const p=await pageFor(second);await p.goto(url);assert.deepEqual(await p.evaluate(()=>[document.cookie,localStorage.getItem('persist')]),['persist=kept','kept']);}finally{await second.stop();}}finally{fs.rmSync(profile,{recursive:true,force:true});}},checks);
  return checks;
}
async function timings(engine){const cold=[],warm=[];for(let i=0;i<3;i++){const t=performance.now(),h=await launch(engine);try{const page=await pageFor(h);await workflow(page);cold.push({ms:+(performance.now()-t).toFixed(2),rss_kib:await rss(h.pid)});}finally{await h.stop();}}const h=await launch(engine);try{const page=await pageFor(h);await workflow(page);for(let i=0;i<3;i++){const t=performance.now();await workflow(page);warm.push({ms:+(performance.now()-t).toFixed(2),rss_kib:await rss(h.pid)});}}finally{await h.stop();}return {cold,warm};}
async function main(){await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}/`;const results={host:{platform:os.platform(),arch:os.arch(),cpus:os.cpus().length,load:os.loadavg(),ram_gib:os.totalmem()/2**30},playwright:require((process.env.PLAYWRIGHT_MODULE||'playwright-core')+'/package.json').version,moli,workload:'local form, trusted input, XHR, identical 1px layout refresh, dynamic button and title assertion; 3 cold / 3 warm; process-tree RSS sampled after completion, not peak',engines:{}};try{for(const engine of engines){const checks=await matrix(engine);results.engines[engine]={checks};const measured=await timings(engine);Object.assign(results.engines[engine],measured);console.log(JSON.stringify({engine,passed:checks.filter(c=>c.pass).length,gaps:checks.filter(c=>!c.pass).map(c=>c.name)}));}}finally{for(const h of active)await h.stop().catch(e=>console.error(e.message));server.closeAllConnections();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));}if(process.argv.includes('--require-fork')){const c=results.engines.moli?.checks;assert.ok(c?.some(c=>c.name==='profile_restart_with_open_cdp'&&c.pass));assert.ok(c?.some(c=>c.name==='html_drag_to_with_dragend'&&c.pass));}}
main().then(()=>{if(process.argv.includes('--require-all')){const r=JSON.parse(fs.readFileSync(path.join(out,'results.json')));for(const engine of engines)assert.ok(r.engines[engine].checks.every(c=>c.pass),JSON.stringify(r.engines[engine].checks.filter(c=>!c.pass)));}}).catch(e=>{console.error(e);process.exitCode=1;server.closeAllConnections();server.close();});
