// Local specimen interactions. No runtime call, persistence, grading or telemetry.
for (const panel of document.querySelectorAll('.preview-theme')) {
  const confidence = panel.querySelector('[data-confidence]');
  const confidenceValue = panel.querySelector('[data-confidence-value]');
  const confidenceLabels = ['Not sure yet', 'A little sure', 'Somewhat sure', 'Fairly sure', 'Very sure'];
  const updateConfidence = () => {
    const text = `${confidence.value} / 4 · ${confidenceLabels[Number(confidence.value)]}`;
    confidenceValue.textContent = text;
    confidence.setAttribute('aria-valuetext', confidenceLabels[Number(confidence.value)]);
  };
  confidence.addEventListener('input', updateConfidence);
  updateConfidence();

  const form = panel.querySelector('[data-answer-form]');
  const response = panel.querySelector('[data-demo-response]');
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    response.hidden = false;
    response.querySelector('[data-response-copy]').textContent = 'Your response is ready. This component preview does not grade answers or update mastery.';
  });
  form.addEventListener('reset', () => {
    response.hidden = true;
    // The browser restores default values after the reset event.
    queueMicrotask(updateConfidence);
  });

  const toast = panel.querySelector('[data-toast]');
  const toastMessage = toast.querySelector('[data-toast-message]');
  const showToast = panel.querySelector('[data-show-toast]');
  showToast.addEventListener('click', () => {
    toast.hidden = false;
    toastMessage.textContent = 'Example notice: progress saved. This preview stores no learner data.';
  });
  toast.querySelector('[data-dismiss-toast]').addEventListener('click', () => {
    toast.hidden = true;
    showToast.focus();
  });

  panel.querySelector('[data-retry]').addEventListener('click', event => {
    const detail = event.currentTarget.closest('.st-state').querySelector('.st-state__detail');
    detail.textContent = 'Preview only: reconnect the lesson host before retrying in an application.';
  });
}
