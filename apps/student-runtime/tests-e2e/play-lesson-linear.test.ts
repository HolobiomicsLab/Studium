describe("Play lesson linear", () => {
  it("plays all 7 scenes and reaches summary", async () => {
    await browser.pause(1500);
    // Accept consent
    const aBox = await $("#a");
    await aBox.click();
    await $("button*=Continuer").then((b) => b.click());
    await browser.pause(500);

    // Click start lesson
    // INT-STUDIUM-034 : la bibliothèque liste des bundles, et son contrôle de démarrage est
    // un <button data-testid='library-load-bundle'> — plus le lien `a*=Démarrer` d'avant.
    // Le bundle joué est mis en scène par `wdio.conf.ts` (STAGED_BUNDLE).
    const start = await $("[data-testid='library-load-bundle']");
    await start.waitForDisplayed({ timeout: 10_000 });
    await start.click();
    await browser.pause(500);

    // Play through 7 scenes
    for (let i = 0; i < 7; i++) {
      await browser.pause(800);
      const continueBtn = await $("button*=Continuer");
      if (await continueBtn.isExisting()) {
        await continueBtn.click();
      } else {
        // Quiz: pick first radio, submit
        const radio = await $("input[type=radio]");
        await radio.click();
        await $("button*=Soumettre").then((b) => b.click());
        await browser.pause(400);
        await $("button*=Continuer").then((b) => b.click());
      }
    }

    await browser.pause(500);
    expect(await browser.getUrl()).toContain("/summary");
  });
});
