#!/usr/bin/env node
// The JSON owns values. This renderer owns only CSS naming and theme precedence.
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const tokens = JSON.parse(await readFile(new URL('tokens.json', root), 'utf8'));
const declarations = (values, prefix = '') => Object.entries(values)
  .map(([key, value]) => `  --st-${prefix}${key}: ${value};`).join('\n');
// Palette snapshots let host bridges refer to brand fallbacks without self-referential variables.
const aliases = Object.fromEntries(Object.entries(tokens.alias).map(([key, value]) => [key, `var(--st-${value})`]));
const theme = name => `${declarations(tokens.color[name], 'palette-')}\n${declarations(tokens.color[name])}\n${declarations(aliases)}\n${declarations(tokens.shadow[name], 'shadow-')}\n  color-scheme: ${name};`;
const basic = [
  declarations(tokens.color.light, 'palette-light-'),
  declarations(tokens.color.dark, 'palette-dark-'),
  ...Object.entries(tokens.typography).map(([key, values]) => declarations(values, `${key}-`)),
  declarations(tokens.spacing, 'space-'),
  declarations(tokens.radius, 'radius-'),
  declarations(tokens.borderWidth, 'border-width-'),
  declarations(tokens.layout, 'layout-'),
  declarations(tokens.motion.duration, 'duration-'),
  declarations(tokens.motion.easing, 'ease-'),
].join('\n');
const reduced = Object.fromEntries(Object.keys(tokens.motion.duration).map(key => [key, tokens.motion.reducedMotion.duration]));
const css = `/* Generated from tokens.json by scripts/build-tokens.mjs. Do not edit values here. */
:root {
${basic}
${theme('light')}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${theme('dark').replace(/^/gm, '  ')}
  }
}

[data-theme="dark"] {
${theme('dark')}
}

[data-theme="light"] {
${theme('light')}
}

@media ${tokens.motion.reducedMotion.query} {
  :root, [data-theme] {
${declarations(reduced, 'duration-').replace(/^/gm, '  ')}
  }
  .st-scope, .st-scope *, .st-scope *::before, .st-scope *::after {
    animation: ${tokens.motion.reducedMotion.animation} !important;
    transition-duration: ${tokens.motion.reducedMotion.duration} !important;
    scroll-behavior: ${tokens.motion.reducedMotion.scrollBehavior} !important;
  }
}
`;
const file = new URL('tokens.css', root);
if (process.argv.includes('--check')) {
  const actual = await readFile(file, 'utf8');
  if (actual !== css) {
    console.error('tokens.css differs from tokens.json. Run node design/scripts/build-tokens.mjs.');
    process.exitCode = 1;
  } else console.log('PASS tokens.css matches tokens.json.');
} else {
  await writeFile(file, css);
  console.log('Wrote design/tokens.css.');
}
