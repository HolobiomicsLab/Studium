/** Translate presentation text without replacing controls or canonical activity data. */
const FR = {
  'Language':'Langue', 'Harness activity · local draft':'Activité accompagnée · brouillon local',
  '1 · Predict':'1 · Prédire', '2 · Observe':'2 · Observer', '3 · Conclude':'3 · Conclure',
  'Source or calculation basis':'Source ou base du calcul',
  'Observation material':'Documents à observer',
  'Available before your prediction · inspect at your own pace':'Disponibles avant votre prédiction · explorez à votre rythme',
  'Recording · choose before you begin':'Enregistrement · choisir avant de commencer',
  'Enable a private in-page trace for optional download, or continue with no trace. This choice cannot be changed without reloading, so actions are never filled in retroactively.':'Activez une trace privée dans cette page, téléchargeable à votre demande, ou continuez sans trace. Ce choix nécessite un rechargement pour être modifié ; aucune action ne sera reconstruite après coup.',
  'Start with local trace':'Commencer avec une trace locale', 'Continue without trace':'Continuer sans trace',
  '01 / Predict · commit your own expectation':'01 / Prédire · formuler votre attente',
  'Prediction':'Prédiction', 'I predict… because…':'Je prédis… parce que…',
  'Confidence (optional, 0–4)':'Confiance (facultative, 0–4)', 'Not recorded':'Non renseignée',
  'Keep prediction and Reveal results':'Conserver la prédiction et afficher les résultats',
  'Export activity trace':'Exporter la trace de l’activité',
  'Nothing is sent or saved automatically. With tracing enabled, a partial export may contain only the start event.':'Rien n’est envoyé ni enregistré automatiquement. Avec une trace active, un export partiel peut ne contenir que le début de l’activité.',
  '02 / Observe and vary':'02 / Observer et faire varier',
  'Expected independent checks':'Vérifications indépendantes attendues',
  'These expected outcomes were hidden until after your prediction. They are instructions, not proof that a check ran.':'Ces résultats attendus étaient masqués avant votre prédiction. Ce sont des consignes ; leur présence ne prouve pas qu’une vérification a été exécutée.',
  '03 / Observe and conclude':'03 / Observer et conclure',
  'Observation (optional)':'Observation (facultative)', 'Conclusion (optional)':'Conclusion (facultative)',
  'Complete and export final trace':'Terminer et exporter la trace finale',
  'Finish activity':'Terminer l’activité', 'Check assistance note':'Consulter la note d’aide',
  'Recording · local trace enabled':'Enregistrement · trace locale activée',
  'Recording · continuing without a trace':'Enregistrement · poursuite sans trace',
  'Local in-page trace enabled. Nothing is persisted until export.':'Trace locale activée dans la page. Rien n’est conservé avant l’export.',
  'Continuing without a trace. Reload to start a trace from the beginning.':'Poursuite sans trace. Rechargez la page pour enregistrer une nouvelle activité dès son début.',
  'Activity finished without creating or downloading a trace.':'Activité terminée sans création ni téléchargement de trace.',
  'Final local trace downloaded.':'Trace locale finale téléchargée.',
  'Partial local trace downloaded; completion was not claimed.':'Trace locale partielle téléchargée ; la fin de l’activité n’est pas déclarée.',
  'Tracing was not enabled; reload to begin without backfilling actions.':'La trace n’était pas activée ; rechargez pour commencer sans reconstruire les actions passées.',
  'No trace is enabled, so this assistance request was not recorded.':'Aucune trace n’est active ; cette demande d’aide n’a pas été enregistrée.',
  'Assistance request recorded in this page only.':'Demande d’aide enregistrée uniquement dans cette page.',
  'Visual support':'Supports visuels', 'Show visual support':'Afficher les supports visuels',
  'Optional explanations · available after your prediction':'Explications facultatives · disponibles après votre prédiction',
  'Local rendering · no AI call':'Rendu local · aucun appel à une IA',
  'Nodes':'Nœuds', 'Visible edges':'Liens visibles', 'Baseline edges':'Liens de référence',
  'Linked IDs':'Identifiants liés', 'Score':'Score', 'Matched peaks':'Pics appariés',
  'Candidate':'Candidat', 'Evidence scope':'Portée des preuves', 'Node ID':'Identifiant du nœud',
  'Follow stable IDs across network, spectra and candidates':'Suivre les identifiants entre réseau, spectres et candidats',
  'Select one stable node ID':'Sélectionner un identifiant de nœud',
  'Select a node to link its spectrum and candidate row.':'Sélectionnez un nœud pour relier son spectre à la ligne du candidat.',
  'Compare supplied scenarios with one decision criterion':'Comparer les scénarios fournis selon un même critère',
  'The baseline and scenario values are supplied captured results. The browser compares those numbers; it does not run a scenario analysis.':'Les valeurs de référence et des scénarios sont des résultats fournis. Le navigateur compare ces nombres ; il n’exécute pas d’analyse des scénarios.',
  'Decision threshold':'Seuil de décision', 'Selected scenario':'Scénario sélectionné',
  'Select a supplied scenario':'Sélectionner un scénario fourni',
  'Choose a scenario to compare its supplied value with the baseline and threshold.':'Choisissez un scénario pour comparer sa valeur à la référence et au seuil.',
};
const EXCLUDED = 'script,style,textarea,input,code,pre,svg,math,.katex,canvas,[translate="no"],#languageControls';
const ATTRIBUTES = ['placeholder', 'aria-label', 'title'];

/** Install an editable language selector; returns setters and observer cleanup. */
export function installActivityLanguage(document, preferences = {}) {
  const originals = new WeakMap();
  const packs = { fr: FR, ...preferences.translations };
  if (preferences.translations?.fr) packs.fr = {...FR, ...preferences.translations.fr};
  let language = preferences.language || 'en';
  const controls = document.getElementById('languageControls');
  const select = document.createElement('select'); select.id = 'activityLanguage';
  const label = document.createElement('label'); label.htmlFor = select.id;
  const status = document.createElement('p'); status.id = 'languageStatus'; status.className = 'privacy';
  const languages = new Set(['en', 'fr', language, ...Object.keys(packs)]);
  for (const value of languages) { const option = document.createElement('option'); option.value = value; option.textContent = value; select.append(option); }
  controls?.append(label, select, status);
  const observer = new document.defaultView.MutationObserver(apply);

  function translate(node, key, value) {
    const records = originals.get(node) || {};
    const previous = records[key];
    const source = previous?.output === value ? previous.source : value;
    const trimmed = source.trim(), dictionary = packs[language] || packs[language.split('-')[0]] || {};
    const output = language === 'en' || !Object.hasOwn(dictionary, trimmed) ? source : source.replace(trimmed, () => dictionary[trimmed]);
    records[key] = {source, output}; originals.set(node, records);
    return output;
  }

  function apply() {
    observer.disconnect();
    // Preserve option semantics before translating their visible labels.
    document.querySelectorAll('option:not([value])').forEach(option => option.value = option.textContent);
    const walker = document.createTreeWalker(document.body, 4);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.parentElement?.closest(EXCLUDED)) node.nodeValue = translate(node, 'text', node.nodeValue);
    }
    document.querySelectorAll('[placeholder],[aria-label],[title]').forEach(node => {
      if (node.closest(EXCLUDED)) return;
      for (const name of ATTRIBUTES) if (node.hasAttribute(name)) node.setAttribute(name, translate(node, name, node.getAttribute(name)));
    });
    document.documentElement.lang = language;
    label.textContent = language.startsWith('fr') ? 'Langue' : 'Language'; select.value = language;
    status.textContent = language.startsWith('fr')
      ? 'Les traductions disponibles sont affichées. Les passages non traduits restent dans leur langue source ; demandez leur traduction au harnais. Vos réponses et les données sont conservées.'
      : 'Available translations are shown; missing translations stay in the source language. Ask your harness to translate them. Your responses and data are preserved.';
    observer.observe(document.body, {subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:ATTRIBUTES});
  }
  function setLanguage(value) {
    try { language = Intl.getCanonicalLocales(value)[0]; } catch { throw new Error('Invalid language tag'); }
    if (!language) throw new Error('Language is required');
    if (![...select.options].some(option => option.value === language)) { const option = document.createElement('option'); option.value = option.textContent = language; select.append(option); }
    apply();
    document.dispatchEvent(new document.defaultView.CustomEvent('studium-language-changed', {detail:{language}}));
  }
  select.addEventListener('change', () => setLanguage(select.value));
  apply();
  return {setLanguage, disconnect:() => observer.disconnect()};
}
