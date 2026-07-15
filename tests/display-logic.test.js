/**
 * display-logic.test.js — Tests for display page logic (displaysilly.html),
 * SSE display connection, and display-side rendering primitives.
 *
 * Ejecutar: node tests/display-logic.test.js
 * (No requiere framework externo — usa asserts nativos de Node.js)
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
  }
}

function readFile(relPath) {
  return fs.readFileSync(path.resolve(__dirname, '..', 'interno', 'frontend', relPath), 'utf8');
}


// ── Test: displaysilly.html structure ──
console.log('\n🧪 displaysilly.html — HTML Structure Tests\n');

test('displaysilly.html has lang="es"', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('lang="es"'), 'Must declare Spanish language');
});

test('displaysilly.html has charset UTF-8', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('charset="UTF-8"') || html.includes('charset="utf-8"'), 'Must declare UTF-8');
});

test('displaysilly.html has viewport meta', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('viewport'), 'Must have viewport meta tag');
});

test('displaysilly.html has connection status pill', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('id="connPill"'), 'Must have connPill element');
  assert(html.includes('id="connText"'), 'Must have connText element');
});

test('displaysilly.html has reconnect overlay', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('id="reconnectOverlay"'), 'Must have reconnectOverlay');
});

test('displaysilly.html has timer badge', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('id="timerBadge"'), 'Must have timer badge');
  assert(html.includes('id="timerNum"'), 'Must have timer number display');
});

test('displaysilly.html has question text area', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('id="qText"'), 'Must have question text element');
});

test('displaysilly.html has answer block', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('id="ansBlock"'), 'Must have answer block');
  assert(html.includes('id="ansText"'), 'Must have answer text');
});

test('displaysilly.html has options container', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('id="optionsContainer"'), 'Must have options container');
});

test('displaysilly.html has scores zone', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('id="scoresZone"'), 'Must have scores zone');
});

test('displaysilly.html has celebration canvas', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('id="celebCanvas"'), 'Must have celebration canvas');
});

test('displaysilly.html has winner overlay', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('id="winnerOverlay"'), 'Must have winner overlay');
});

test('displaysilly.html has final results overlay', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('id="finalResultsOverlay"'), 'Must have final results overlay');
});

test('displaysilly.html has welcome overlay', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('id="welcomeOverlay"'), 'Must have welcome overlay');
});

test('displaysilly.html has progress bar', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('id="qProgress"'), 'Must have question progress');
  assert(html.includes('id="qProgressBar"'), 'Must have progress bar');
});

test('displaysilly.html loads display-base.css', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('display-base.css'), 'Must load display-base.css');
});

test('displaysilly.html loads display-overlays.css', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('display-overlays.css'), 'Must load display-overlays.css');
});

test('displaysilly.html loads display-mcq.css', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('display-mcq.css'), 'Must load display-mcq.css');
});

test('displaysilly.html has file:// protocol detection', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes("location.protocol === \"file:\"") || html.includes("location.protocol === 'file:'"),
    'Must detect file:// protocol and warn user');
});

test('displaysilly.html has SSE timeout detection', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('__sseConnected'), 'Must track SSE connection status');
  assert(html.includes('7000') || html.includes('7s'), 'Must have timeout detection (~7s)');
});

test('displaysilly.html has ambient effects layer', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('id="ambientLayer"'), 'Must have ambient effects layer');
});

test('displaysilly.html has screen crack overlay', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('id="crackOverlay"'), 'Must have crack overlay for effects');
});

test('displaysilly.html has fullscreen takeover layer', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('id="fullscreenTakeover"'), 'Must have fullscreen takeover');
});

test('displaysilly.html has hard question banner', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('id="hardQuestionBanner"'), 'Must have hard question banner');
});

test('displaysilly.html has flash overlay', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('id="flashOverlay"'), 'Must have flash overlay');
});

test('displaysilly.html has decor corner elements', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('decor-corner'), 'Must have decorative corner elements');
});

test('displaysilly.html has category badge', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('id="qCatBadge"'), 'Must have category badge');
});

test('displaysilly.html has eyebrow label', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('id="qEyebrow"'), 'Must have eyebrow label');
});


// ── Test: Display CSS files exist ──
console.log('\n🧪 Display CSS — File Existence Tests\n');

test('display-base.css exists', () => {
  const cssPath = path.resolve(__dirname, '..', 'interno', 'frontend', 'css', 'display-base.css');
  assert(fs.existsSync(cssPath), 'display-base.css must exist');
});

test('display-overlays.css exists', () => {
  const cssPath = path.resolve(__dirname, '..', 'interno', 'frontend', 'css', 'display-overlays.css');
  assert(fs.existsSync(cssPath), 'display-overlays.css must exist');
});

test('display-mcq.css exists', () => {
  const cssPath = path.resolve(__dirname, '..', 'interno', 'frontend', 'css', 'display-mcq.css');
  assert(fs.existsSync(cssPath), 'display-mcq.css must exist');
});

test('display-robust.css exists', () => {
  const cssPath = path.resolve(__dirname, '..', 'interno', 'frontend', 'css', 'display-robust.css');
  assert(fs.existsSync(cssPath), 'display-robust.css must exist');
});


// ── Test: Display SSE endpoint structure ──
console.log('\n🧪 Display SSE — Stream Endpoint Tests\n');

test('SSE stream endpoint defined in api.py', () => {
  const apiCode = readFile('../silly/blueprints/api.py');
  assert(apiCode.includes('/stream') || apiCode.includes('stream'), 'Must have /stream endpoint');
});

test('Display endpoint returns HTML content', () => {
  const displayCode = readFile('../silly/blueprints/display.py');
  assert(displayCode.includes('displaysilly.html'), 'Must serve displaysilly.html');
});


// ── Test: Connection pill states ──
console.log('\n🧪 Connection Pill — State Management Tests\n');

test('Connection pill has init state', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('conn-init'), 'Must have conn-init class');
});

test('Connection pill has error state', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('conn-error'), 'Must have conn-error class');
});

test('Connection pill has down state', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('conn-down'), 'Must have conn-down class');
});

test('__setConn function defined globally', () => {
  const html = readFile('displaysilly.html');
  assert(html.includes('window.__setConn'), 'Must define __setConn globally');
});


console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
console.log('='.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
