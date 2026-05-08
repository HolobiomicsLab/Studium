describe("Calibration mismatch panel", () => {
  it("shows CalibrationPanel after confidence=4 + wrong answers", async () => {
    await browser.pause(1500);
    await $("#a").then((b) => b.click());
    await $("button*=Continuer").then((b) => b.click());
    await browser.pause(500);
    await $("a*=Démarrer").then((l) => l.click());
    await browser.pause(500);

    // Navigate to meta_checkpoint scene — skip intro/concept
    for (let i = 0; i < 2; i++) {
      const continueBtn = await $("button*=Continuer");
      if (await continueBtn.isExisting()) {
        await continueBtn.click();
        await browser.pause(400);
      }
    }

    // On meta_checkpoint: click scale label 4 (max confidence)
    const labels = await $$("button.rounded");
    if (labels.length > 0) {
      await labels[labels.length - 1].click();
      await browser.pause(200);
      await $("button*=Continuer").then((b) => b.click());
      await browser.pause(400);
    }

    // Answer next quiz wrong 3 times to create mismatch
    for (let i = 0; i < 3; i++) {
      const isQuiz = await $("button*=Soumettre").isExisting();
      if (!isQuiz) break;
      const radios = await $$("input[type=radio]");
      await radios[radios.length - 1].click();
      await $("button*=Soumettre").then((b) => b.click());
      await browser.pause(400);
      await $("button*=Continuer").then((b) => b.click());
      await browser.pause(400);
    }

    // CalibrationPanel should be visible
    const panel = await $("h3*=Calibration");
    expect(await panel.isExisting()).toBe(true);
    await $("button*=OK").then((b) => b.click());
  });
});
