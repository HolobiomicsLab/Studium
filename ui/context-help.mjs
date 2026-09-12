/** Render authored catalogue entries as escaped native HTML, without learner data. */
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');
const paragraph = (label, value) => `<p><strong>${escape(label)}:</strong> ${escape(value)}</p>`;

function localizedBody(topic, locale, audience, labels) {
  const item = topic[locale], other = audience === 'student' ? 'teacher' : 'student';
  const intro = `<h3>${escape(item.title)}</h3><p>${escape(item.what)}</p>`;
  const first = paragraph(labels[audience], item[audience]);
  const objective = paragraph(labels.objective, item.objective);
  const more = [other, 'method', 'limit'].map(key => paragraph(labels[key], item[key])).join('');
  const source = paragraph(labels.source, topic.source);
  return `<div data-help-locale="${locale}" lang="${locale}">${intro}${first}${objective}<details class="studium-help-more"><summary>${escape(labels.more)}</summary>${more}${source}</details></div>`;
}

/** One known topic and explicit audience produce passive bilingual disclosure HTML. */
export function renderHelp(topicId, catalogue, audience = 'student') {
  if (!Object.hasOwn(catalogue.topics, topicId)) throw Error(`Unknown help topic: ${topicId}`);
  if (!['student', 'teacher'].includes(audience)) throw Error('Unknown help audience');
  const topic = catalogue.topics[topicId];
  const names = ['en', 'fr'].map(loc => `<span class="studium-help-sr" data-help-locale="${loc}" lang="${loc}">${escape(catalogue.labels[loc].about)}: ${escape(topic[loc].title)}</span>`).join('');
  const body = ['en', 'fr'].map(loc => localizedBody(topic, loc, audience, catalogue.labels[loc])).join('');
  return `<details class="studium-help" data-help-topic="${escape(topicId)}" translate="no"><summary><span aria-hidden="true">?</span>${names}</summary><div class="studium-help-box">${body}</div></details>`;
}
