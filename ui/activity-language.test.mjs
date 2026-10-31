import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installActivityLanguage } from './activity-language.mjs';
const require = createRequire(new URL('../packages/activity-presentation/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('language changes preserve learner input, choice values, IDs and listeners', async () => {
  const dom = new JSDOM('<html><body><div id="languageControls"></div><button id="b">Start with local trace</button><textarea>My own answer</textarea><select id="answerChoice"><option>Not recorded</option></select><code>Start with local trace</code><p id="source">Authored claim</p></body></html>');
  const { document } = dom.window;
  const button = document.querySelector('#b'); let clicked = 0;
  button.onclick = () => clicked++;
  const control = installActivityLanguage(document, {language:'fr', translations:{fr:{'Authored claim':'Énoncé traduit'}}});
  await settle();
  assert.equal(button.textContent, 'Commencer avec une trace locale');
  assert.equal(document.querySelector('textarea').value, 'My own answer');
  assert.equal(document.querySelector('#answerChoice option').value, 'Not recorded');
  assert.equal(document.querySelector('code').textContent, 'Start with local trace');
  assert.equal(document.querySelector('#source').textContent, 'Énoncé traduit');
  button.click(); assert.equal(clicked, 1);
  control.setLanguage('en'); await settle();
  assert.equal(button.textContent, 'Start with local trace');
  assert.equal(document.querySelector('#source').textContent, 'Authored claim');
  control.disconnect();
});

test('late dynamic content is translated, unsupported text kept and locale reversible', async () => {
  const dom = new JSDOM('<html><body><div id="languageControls"></div><button>Prediction</button><p id="source">Original source</p></body></html>');
  const {document} = dom.window;
  const control = installActivityLanguage(document, {language:'fr'});
  document.querySelector('button').textContent = 'Finish activity';
  await settle();
  assert.equal(document.querySelector('button').textContent, 'Terminer l’activité');
  assert.equal(document.querySelector('#source').textContent, 'Original source');
  control.setLanguage('zh-Hans'); await settle();
  assert.equal(document.documentElement.lang, 'zh-Hans');
  assert.equal(document.querySelector('button').textContent, 'Finish activity');
  assert.match(document.querySelector('#languageStatus').textContent, /source|translation/i);
  control.disconnect();
});

test('translation text keeps literal dollar notation and is never treated as replacement syntax', () => {
  const dom = new JSDOM('<html><body><div id="languageControls"></div><p id="source">Notation</p></body></html>');
  const control = installActivityLanguage(dom.window.document, {language:'fr',translations:{fr:{Notation:'$& and $$ remain literal'}}});
  assert.equal(dom.window.document.querySelector('#source').textContent, '$& and $$ remain literal');
  control.disconnect();
});
