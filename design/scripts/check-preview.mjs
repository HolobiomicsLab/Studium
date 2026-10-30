#!/usr/bin/env node
// Offline DOM/interaction checks using the repository's existing jsdom dependency.
// jsdom has no layout engine: this does NOT certify viewport fit or browser paint.
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const require = createRequire(new URL('apps/studium-vscode/package.json', root));
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');
const cssRequire = createRequire(require.resolve('jsdom'));
const cssTree = cssRequire('css-tree');
const file = new URL('design/preview.html', root);
const html = await readFile(file, 'utf8');
assert(!/https?:\/\//i.test(html), 'preview.html must not contain an HTTP(S) URL.');

for (const name of ['tokens.css', 'components.css', 'vscode-bridge.css', 'preview.css']) {
  const css = await readFile(new URL(`design/${name}`, root), 'utf8');
  const errors = [];
  cssTree.parse(css, { onParseError: error => errors.push(error.message) });
  assert.deepEqual(errors, [], `${name}: CSS parse errors`);
  assert(!/@import\b|https?:\/\//i.test(css), `${name}: external dependency`);
}
console.log('PASS four CSS files parse; no remote imports or URLs.');

let networkAttempts = 0;
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', error => errors.push(error.message));
const dom = await JSDOM.fromFile(fileURLToPath(file), {
  resources: { interceptors: [requestInterceptor(request => {
    if (!request.url.startsWith('file:')) {
      networkAttempts += 1;
      throw new Error('Network is disabled for this preview check.');
    }
  })] },
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse(window) {
    const rejectNetwork = () => { networkAttempts += 1; throw new Error('Network is disabled.'); };
    window.fetch = rejectNetwork;
    window.XMLHttpRequest = rejectNetwork;
    window.WebSocket = rejectNetwork;
  },
});

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Local preview load timed out.')), 5000);
    dom.window.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
  });
  const { document, Event, getComputedStyle } = dom.window;
  assert.deepEqual(errors, [], 'Local resource/script errors.');
  const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
  assert.equal(ids.length, new Set(ids).size, 'IDs must remain unique across themes.');

  for (const element of document.querySelectorAll('[src], [href]')) {
    const reference = element.getAttribute('src') ?? element.getAttribute('href');
    if (reference.startsWith('#')) {
      assert(document.getElementById(reference.slice(1)), `Missing anchor ${reference}`);
    } else {
      const url = new URL(reference, file);
      assert.equal(url.protocol, 'file:', `Non-local reference ${reference}`);
      await access(url);
    }
  }
  for (const element of document.querySelectorAll('[aria-labelledby], [aria-describedby], output[for]')) {
    const references = element.getAttribute('aria-labelledby') ?? element.getAttribute('aria-describedby') ?? element.getAttribute('for');
    for (const id of references.split(/\s+/)) assert(document.getElementById(id), `Missing accessible reference ${id}`);
  }
  for (const input of document.querySelectorAll('input, textarea, meter')) {
    assert(input.labels?.length, `${input.id || input.type} needs a native label.`);
  }
  console.log(`PASS local page loaded without network; ${ids.length} unique IDs and all local/accessible references resolve.`);

  for (const theme of ['light', 'dark']) {
    const panel = document.querySelector(`.preview-theme[data-theme="${theme}"]`);
    assert(panel, `Missing ${theme} panel.`);
    const tokens = JSON.parse(await readFile(new URL('design/tokens.json', root), 'utf8'));
    assert.equal(getComputedStyle(panel).getPropertyValue('--st-canvas').trim(), tokens.color[theme].canvas);
    assert.equal(panel.querySelectorAll('.st-segments [data-state="current"]').length, 1);
    for (const keyClass of Object.keys(tokens.semantics.sceneClasses)) assert(panel.querySelector(`[data-key-class="${keyClass}"]`));
    for (const verdict of ['correct', 'incorrect', 'acknowledged', 'keyword-only']) assert(panel.querySelector(`[data-verdict="${verdict}"]`));
    assert.match(panel.querySelector('[data-verdict="keyword-only"]').textContent, /Not certified/);
    assert(panel.querySelector('[data-kind="concept"]'));
    assert(panel.querySelector('[data-kind="task"]'));
    assert(panel.querySelector('[data-state="mastered"]'));
    assert(panel.querySelector('[data-state="due"]'));

    const range = panel.querySelector('[data-confidence]');
    range.value = '4';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    assert.match(panel.querySelector('[data-confidence-value]').textContent, /4 \/ 4 · Very sure/);
    assert.equal(range.getAttribute('aria-valuetext'), 'Very sure');

    const details = panel.querySelector('details');
    details.querySelector('summary').click();
    assert.equal(details.open, true);
    details.querySelector('summary').click();
    assert.equal(details.open, false);

    const form = panel.querySelector('form');
    form.querySelector('textarea').value = 'An independent check can challenge the claim.';
    form.querySelector('[type="submit"]').click();
    const response = panel.querySelector('[data-demo-response]');
    assert.equal(response.hidden, false);
    assert.match(response.textContent, /does not grade/);
    form.querySelector('[type="reset"]').click();
    await Promise.resolve();
    assert.equal(response.hidden, true);
    assert.equal(range.value, '3');
    assert.match(panel.querySelector('[data-confidence-value]').textContent, /3 \/ 4/);

    const showToast = panel.querySelector('[data-show-toast]');
    showToast.click();
    assert.equal(panel.querySelector('[data-toast]').hidden, false);
    panel.querySelector('[data-dismiss-toast]').click();
    assert.equal(panel.querySelector('[data-toast]').hidden, true);
    assert.equal(document.activeElement, showToast, 'Dismissal restores focus.');
    panel.querySelector('[data-retry]').click();
    assert.match(panel.querySelector('.st-state--error').textContent, /Preview only/);
    console.log(`PASS ${theme}: scene classes, feedback, node states, confidence, hint, submit/reset, toast/focus and retry.`);
  }
  assert.equal(networkAttempts, 0, 'Preview attempted a network request.');
  assert.deepEqual(errors, [], 'Script or resource errors during interaction.');
  console.log('PASS 0 network attempts; 0 script/resource errors.');
  console.log('LIMIT: DOM checks do not render layout, native controls, focus rings or the 375 px viewport.');
} finally {
  dom.window.close();
}

// Verify host-token ownership through the matched CSS cascade. The small resolver
// covers custom-property values; it is not a substitute for browser rendering.
const bridgeCss = (await Promise.all(['tokens.css', 'components.css', 'vscode-bridge.css']
  .map(name => readFile(new URL(`design/${name}`, root), 'utf8')))).join('\n');
const fixture = new JSDOM(`<html data-theme="light"><head><style>${bridgeCss}</style></head><body class="st-scope"></body></html>`);
try {
  const { document, getComputedStyle } = fixture.window;
  const body = document.body;
  function resolveProperty(name, seen = []) {
    assert(!seen.includes(name), `Cyclic variable: ${name}`);
    let owner = body;
    let raw = '';
    while (owner && !raw) {
      raw = getComputedStyle(owner).getPropertyValue(name).trim();
      if (!raw) owner = owner.parentElement;
    }
    function resolve(value) {
      const variable = value.match(/^var\((--[\w-]+)(?:,\s*(.*))?\)$/);
      return variable ? (resolveProperty(variable[1], [...seen, name]) || resolve(variable[2] ?? '')) : value;
    }
    return resolve(raw);
  }
  const tokens = JSON.parse(await readFile(new URL('design/tokens.json', root), 'utf8'));
  for (const theme of ['vscode-light', 'vscode-dark', 'vscode-high-contrast', 'vscode-high-contrast-light']) {
    body.className = `st-scope ${theme}`;
    body.setAttribute('style', '--vscode-editor-background:#102030;--vscode-editor-foreground:#eeeeee;--vscode-button-background:#123456;--vscode-button-foreground:#ffffff;--vscode-textLink-foreground:#abcdef;--vscode-focusBorder:#ffff00;');
    for (const [token, expected] of Object.entries({ canvas: '#102030', text: '#eeeeee', 'button-background': '#123456', 'button-foreground': '#ffffff', accent: '#abcdef', focus: '#ffff00' })) {
      assert.equal(resolveProperty(`--st-${token}`), expected, `${theme}: host ${token} must win.`);
    }
    body.removeAttribute('style');
    const palette = theme.endsWith('light') ? tokens.color.light : tokens.color.dark;
    assert.equal(resolveProperty('--st-canvas'), palette.canvas);
    assert.equal(resolveProperty('--st-text'), palette.text);
  }
  console.log('PASS bridge cascade: host background/text/button/link/focus colours win in all four VS Code theme classes.');
  console.log('PASS bridge fallbacks follow the VS Code class independently of the root web theme.');
} finally {
  fixture.window.close();
}
