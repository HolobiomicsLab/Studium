/** Compile the actual extension helper, then operate the real pane for every scene type. */
import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import catalogue from '../../../ui/context-help.json';

const entry = fileURLToPath(new URL('./contextual-help.ts', import.meta.url));
const compiled = buildSync({ entryPoints: [entry], bundle: true, write: false,
  platform: 'node', format: 'cjs', loader: { '.css': 'text' } });
const container = { exports: {} as { lessonHelpTemplates: () => string; helpStyles: string; graphHelp: () => string } };
runInNewContext(compiled.outputFiles[0].text, { module: container, exports: container.exports });
const help = container.exports;
assert.ok(help.helpStyles.includes('.studium-help'));
assert.ok(help.graphHelp().includes('data-help-topic="universes"'));
const source = readFileSync(new URL('../media/artifact-pane.js', import.meta.url), 'utf8');
const dom = new JSDOM(`<html lang="fr"><body>${help.lessonHelpTemplates()}<div id="pane"></div></body></html>`, { runScripts: 'outside-only' });
dom.window.eval(source);
const messages: unknown[] = [];
Object.assign(dom.window, { __send: (message: unknown) => messages.push(message) });
for (const [type, topic] of Object.entries(catalogue.scene_topics)) {
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: {
    type: 'render', scene: { id: 'test', type, title: 'Public title' }, scene_assets: [],
  } }));
  const tip = dom.window.document.querySelector<HTMLDetailsElement>('#pane .studium-help');
  assert.equal(tip?.dataset.helpTopic, topic, type);
  tip?.querySelector('summary')?.click();
  assert.equal(tip?.open, true, type);
  assert.equal(messages.length, 0, 'help must never submit a host action');
}
dom.window.close();
console.log('OK — shared help for 13 scene types, graph, bundled CSS and zero host messages.');
