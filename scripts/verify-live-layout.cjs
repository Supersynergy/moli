#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const {spawn, execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const binary = arg('--moli') || 'moli';
const live = !process.argv.includes('--snapshot');
const out = path.resolve(arg('--out') || 'target/live-geometry');
fs.mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
const fixture = '<!doctype html><style>input,button{padding:12px;margin:12px}</style><input id=name><button>Save</button>';
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(fixture); });
let child, browser;
async function check(name, fn) {
  try { const observed = await fn(); checks.push({name, pass: true, observed}); }
  catch (error) { checks.push({name, pass: false, error: error.message}); }
}
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  if (live) await check('live_layout_requires_real_layout', async () => {
    let rejected;
    const invalidEnv = {...process.env};
    delete invalidEnv.MOLI_LAYOUT;
    try {
      execFileSync(binary, ['serve', '--host', '127.0.0.1', '--port', String(port), '--live-layout'], {
        env: invalidEnv, timeout: 1500, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) { rejected = error; }
    assert.equal(rejected?.status, 2);
    assert.match(String(rejected.stderr), /--layout/);
    return {exit: rejected.status};
  });
  const log = fs.openSync(path.join(out, 'moli.log'), 'w');
  child = spawn(binary, ['serve', '--host', '127.0.0.1', '--port', String(port), '--layout', ...(live ? ['--live-layout'] : [])], {stdio: ['ignore', log, log]});
  fs.closeSync(log);
  try {
    let ready = false;
    for (let i = 0; i < 160; i++) {
      if (child.exitCode !== null || child.signalCode !== null) throw Error('Moli exited before CDP readiness');
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) { ready = true; break; } } catch {}
      await sleep(50);
    }
    assert.ok(ready, 'CDP readiness exceeded 8 seconds');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {timeout: 5000});
    const page = await browser.contexts()[0].newPage(); page.setDefaultTimeout(3500);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.captureScreenshot', {format: 'png', clip: {x: 0, y: 0, width: 1, height: 1, scale: 1}});
    await check('raw_dynamic_geometry', async () => {
      const r = await page.evaluate(() => { const b = document.createElement('button'); b.id = 'raw'; b.textContent = 'Fresh'; document.body.prepend(b); const r = b.getBoundingClientRect(); return {width: r.width, height: r.height}; });
      assert.ok(r.width > 0 && r.height > 0, JSON.stringify(r)); return r;
    });
    await check('layout_refresh_via_dom_geometry', async () => { const r = await page.locator('#raw').boundingBox(); assert.ok(r?.width > 0, JSON.stringify(r)); return r; });
    if (live) {
      await check('live_style_and_cssom_geometry', async () => {
        const r = await page.evaluate(() => { const b = document.querySelector('#raw'); b.style.width = '77px'; b.style.boxSizing = 'border-box'; const inline = b.getBoundingClientRect().width; const s = document.createElement('style'); s.textContent = '#raw{height:39px;box-sizing:border-box}'; document.head.append(s); const stylesheet = b.getBoundingClientRect().height; s.sheet.insertRule('#raw{height:53px}', 1); const cssom = b.getBoundingClientRect().height; return {inline, stylesheet, cssom}; });
        assert.deepEqual(r, {inline: 77, stylesheet: 39, cssom: 53}); return r;
      });
      await check('live_viewport_geometry', async () => {
        await page.evaluate(() => { const b = document.querySelector('#raw'); b.style.width = '50vw'; });
        await page.setViewportSize({width: 800, height: 600});
        const first = await page.evaluate(() => document.querySelector('#raw').getBoundingClientRect().width);
        await page.setViewportSize({width: 1000, height: 600});
        const second = await page.evaluate(() => document.querySelector('#raw').getBoundingClientRect().width);
        assert.deepEqual([first, second], [400, 500]); return {first, second};
      });
      await check('live_child_frame_geometry', async () => {
        await page.evaluate(() => { const f = document.createElement('iframe'); f.id = 'geometry-frame'; f.srcdoc = '<!doctype html><div id=child style="width:20px;height:15px" onclick="this.dataset.trusted=event.isTrusted">Child</div>'; document.body.append(f); });
        const frame = page.frameLocator('#geometry-frame'); await frame.locator('#child').waitFor({state: 'attached'});
        const r = await frame.locator('#child').evaluate(node => { const before = node.getBoundingClientRect().width; node.style.width = '43px'; return {before, after: node.getBoundingClientRect().width}; });
        assert.deepEqual(r, {before: 20, after: 43});
        await frame.locator('#child').click();
        assert.equal(await frame.locator('#child').getAttribute('data-trusted'), 'true'); return r;
      });
    }
    await cdp.detach();
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM'); for (let i = 0; i < 65 && child.exitCode === null && child.signalCode === null; i++) await sleep(100);
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await new Promise(resolve => child.once('exit', resolve)); throw Error('Owned Moli shutdown exceeded 6.5 seconds'); }
    }
    if (browser) await browser.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    const result = {binary, live, expected: 'fresh DOM geometry has positive dimensions; native DOM box reads agree', checks, passed: checks.filter(c => c.pass).length, failed: checks.filter(c => !c.pass).length, own_child_remaining: !!child && child.exitCode === null && child.signalCode === null};
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  }
  if (checks.some(c => !c.pass)) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; server.closeAllConnections(); server.close(); });
