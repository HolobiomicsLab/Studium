import catalogue from '../../../ui/context-help.json';
import { renderHelp } from '../../../ui/context-help.mjs';
import helpStyles from '../../../ui/context-help.css';

export { helpStyles };

/** Bundle passive, answer-free help templates for the public scene types. */
export function lessonHelpTemplates(): string {
  return Object.entries(catalogue.scene_topics).map(([type, topic]) =>
    `<template id="studium-help-${type}">${renderHelp(topic, catalogue)}</template>`).join('');
}

/** Explain the graph's alternatives, without consulting learner state. */
export function graphHelp(): string {
  return renderHelp('universes', catalogue);
}
