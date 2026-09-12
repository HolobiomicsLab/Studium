"use client";

import catalogue from '../../ui/context-help.json';
import { renderHelp } from '../../ui/context-help.mjs';

/** Shared authored help; native disclosure does not submit or track a response. */
export function ContextHelp({ topic, audience = 'student', language = 'fr' }: {
  topic: keyof typeof catalogue.topics;
  audience?: 'student' | 'teacher';
  language?: 'en' | 'fr';
}) {
  const markup = renderHelp(topic, catalogue, audience)
    .replace('translate="no"', `translate="no" data-help-language="${language}"`);
  return <div onKeyDown={event => {
    if (event.key !== 'Escape') return;
    const tip = event.currentTarget.querySelector<HTMLDetailsElement>('.studium-help');
    if (!tip?.open) return;
    tip.open = false;
    tip.querySelector<HTMLElement>('summary')?.focus();
  }} dangerouslySetInnerHTML={{ __html: markup }} />;
}
