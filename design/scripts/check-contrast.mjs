#!/usr/bin/env node
// WCAG 2.2 relative luminance, for the opaque sRGB pairs declared by the system.
import { readFile } from 'node:fs/promises';

const tokens = JSON.parse(await readFile(new URL('../tokens.json', import.meta.url), 'utf8'));
const minimum = { text: 4.5, 'large-text': 3, ui: 3 };

function luminance(hex) {
  if (!/^#[\da-f]{6}$/i.test(hex ?? '')) throw new Error(`Expected opaque #RRGGBB, got ${hex}`);
  const [r, g, b] = hex.slice(1).match(/../g).map(channel => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

try {
  if (!Array.isArray(tokens.contrastPairs) || tokens.contrastPairs.length === 0) throw new Error('No declared contrast pairs.');
  for (const theme of ['light', 'dark']) {
    if (!tokens.color[theme]) throw new Error(`Missing ${theme} theme.`);
    for (const value of Object.values(tokens.color[theme])) luminance(value);
  }
  const lightKeys = Object.keys(tokens.color.light).sort();
  const darkKeys = Object.keys(tokens.color.dark).sort();
  if (JSON.stringify(lightKeys) !== JSON.stringify(darkKeys)) throw new Error('Theme token keys differ.');

  console.log('| Foreground / background | AA min | Light | Dark | Result |');
  console.log('| :--- | ---: | ---: | ---: | :--- |');
  let pairs = 0;
  let failures = 0;
  for (const pair of tokens.contrastPairs) {
    if (!(pair.kind in minimum) || !Array.isArray(pair.backgrounds) || pair.backgrounds.length === 0) throw new Error(`Invalid pair: ${JSON.stringify(pair)}`);
    for (const background of pair.backgrounds) {
      const ratios = ['light', 'dark'].map(theme => contrast(tokens.color[theme][pair.foreground], tokens.color[theme][background]));
      // Compare unrounded values. Rounding in the report cannot turn a failure into a pass.
      const pass = ratios.every(value => value >= minimum[pair.kind]);
      pairs += 1;
      if (!pass) failures += 1;
      const suffix = pair.kind === 'text' ? '' : ` (${pair.kind})`;
      console.log(`| ${pair.foreground} / ${background}${suffix} | ${minimum[pair.kind].toFixed(1)} | ${ratios[0].toFixed(2)} | ${ratios[1].toFixed(2)} | ${pass ? 'PASS' : 'FAIL'} |`);
    }
  }
  console.log(`\n${pairs} declared pairs × 2 themes = ${pairs * 2} checks; ${failures} failing pairs.`);
  console.log('Normal text ≥ 4.5:1; large text and essential UI ≥ 3:1. Decorative dividers and brand ochre are not text/UI boundaries.');
  if (failures) process.exitCode = 1;
} catch (error) {
  console.error(`Contrast check failed: ${error.message}`);
  process.exitCode = 1;
}
