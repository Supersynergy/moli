#!/usr/bin/env node
// Destructive only to this script's own temporary profile and child processes.
// Keep CDP open during every shutdown to exercise final profile checkpointing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';

const index = process.argv.indexOf('--bin');
assert.ok(index >= 0 && process.argv[index + 1], 'usage: node scripts/test-profile-lifecycle.mjs --bin /absolute/path/to/moli');
const bin = fs.realpathSync(process.argv[index + 1]);
assert.notEqual(process.platform, 'win32', 'POSIX signals are required');
const checks = [], children = new Set(), sockets = new Set();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moli-lifecycle-'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = child => child.exitCode === null && child.signalCode === null;
async function until(fn, label, ms = 8000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { const result = await fn(); if (result) return result; } catch (error) { last = error; }
    await delay(30);
  }
  throw new Error(`${label}: ${last?.message || 'deadline exceeded'}`);
}
async function port() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}
function launch(profile, p) {
  const child = spawn(bin, ['serve', '--host', '127.0.0.1', '--port', String(p), '--profile-dir', profile], {stdio: ['ignore', 'ignore', 'pipe']});
  children.add(child);
  child.on('error', error => { child.launchError = error; });
  child.stderr.on('data', () => {});
  return child;
}
async function ready(child, p) {
  return until(async () => {
    if (child.launchError) throw child.launchError;
    assert.ok(alive(child), `Moli exited before readiness: ${child.exitCode}/${child.signalCode}`);
    const response = await fetch(`http://127.0.0.1:${p}/json/version`, {signal: AbortSignal.timeout(500)});
    if (!response.ok) return false;
    return response.json();
  }, 'CDP readiness');
}
async function connection(p) {
  const response = await fetch(`http://127.0.0.1:${p}/json/version`);
  const {webSocketDebuggerUrl} = await response.json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map(); let sequence = 0;
  sockets.add(ws);
  ws.addEventListener('message', ({data}) => {
    const event = JSON.parse(data), wait = pending.get(event.id);
    if (!wait) return;
    pending.delete(event.id); clearTimeout(wait.timer);
    event.error ? wait.reject(new Error(event.error.message)) : wait.resolve(event.result);
  });
  ws.addEventListener('close', () => {
    for (const wait of pending.values()) { clearTimeout(wait.timer); wait.reject(new Error('CDP closed')); }
    pending.clear(); sockets.delete(ws);
  });
  await Promise.race([once(ws, 'open'), delay(5000).then(() => { throw new Error('CDP websocket deadline'); })]);
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} deadline`)); }, 5000);
    pending.set(id, {resolve, reject, timer});
    ws.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
  });
  const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
  const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
  const call = (method, params = {}) => send(method, params, sessionId);
  const evaluate = async expression => {
    const value = await call('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    assert.ok(!value.exceptionDetails, JSON.stringify(value.exceptionDetails));
    return value.result.value;
  };
  return {ws, call, evaluate};
}
async function stop(child, signal) {
  const started = performance.now();
  assert.ok(child.kill(signal), `deliver ${signal}`);
  await until(() => !alive(child), `${signal} controlled exit`, 7500);
  assert.equal(child.signalCode, null, `${signal} must be handled`);
  assert.equal(child.exitCode, 0, `${signal} must complete successfully`);
  children.delete(child);
  return Math.round(performance.now() - started);
}
const fixture = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><title>Profile lifecycle</title><p id="ready">ready</p>');
});
fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
const url = `http://127.0.0.1:${fixture.address().port}/`;
try {
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    const profile = path.join(root, signal), p = await port();
    const first = launch(profile, p); await ready(first, p);
    const cdp = await connection(p);
    await cdp.call('Page.enable'); await cdp.call('Page.navigate', {url});
    await until(() => cdp.evaluate('!!document.querySelector("#ready")'), 'fixture navigation');
    await cdp.evaluate('document.cookie="kept=old; Path=/; Max-Age=3600";document.cookie="gone=old; Path=/; Max-Age=3600";localStorage.setItem("proof","kept");true');
    // A second writer must fail while the original owns its profile.
    const contender = launch(profile, await port());
    await until(() => !alive(contender), 'profile lock refusal', 3000);
    assert.notEqual(contender.exitCode, 0); children.delete(contender);
    assert.ok(alive(first), 'profile lock contender must not terminate owner');
    // Update and delete just before the signal, without a tab/CDP close.
    await cdp.evaluate('document.cookie="kept=new; Path=/; Max-Age=3600";document.cookie="gone=; Path=/; Max-Age=0";true');
    const elapsed_ms = await stop(first, signal);
    cdp.ws.close();
    const second = launch(profile, p); await ready(second, p);
    const restored = await connection(p);
    await restored.call('Page.enable'); await restored.call('Page.navigate', {url});
    await until(() => restored.evaluate('!!document.querySelector("#ready")'), 'restart navigation');
    const state = await restored.evaluate('({cookie:document.cookie,storage:localStorage.getItem("proof")})');
    assert.match(state.cookie, /(?:^|;\s*)kept=new(?:;|$)/);
    assert.doesNotMatch(state.cookie, /(?:^|;\s*)gone=/);
    assert.equal(state.storage, 'kept');
    await stop(second, signal); restored.ws.close();
    checks.push({signal, pass: true, elapsed_ms, checks: ['open-CDP restart', 'cookie update', 'cookie deletion', 'localStorage', 'exclusive profile', 'lock release', 'exit zero']});
  }
  console.log(JSON.stringify({binary: bin, sha256: createHash('sha256').update(fs.readFileSync(bin)).digest('hex'), checks}, null, 2));
} finally {
  for (const ws of sockets) ws.close();
  for (const child of children) {
    if (alive(child)) child.kill('SIGKILL');
    if (alive(child)) await once(child, 'exit');
  }
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  fs.rmSync(root, {recursive: true, force: true});
}
