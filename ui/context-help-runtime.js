/* Optional enhancement; native disclosures also work without JavaScript. */
(() => {
  if (document.documentElement.dataset.studiumHelpInstalled) return;
  document.documentElement.dataset.studiumHelpInstalled = 'true';
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const focused = document.activeElement?.closest('.studium-help[open]');
    document.querySelectorAll('.studium-help[open]').forEach(tip => { tip.open = false; });
    focused?.querySelector('summary')?.focus();
  });
  document.addEventListener('click', event => {
    document.querySelectorAll('.studium-help[open]').forEach(tip => {
      if (!tip.contains(event.target)) tip.open = false;
    });
  });
})();
