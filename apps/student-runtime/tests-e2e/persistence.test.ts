describe("State persistence across restarts", () => {
  it("resumes lesson at the correct scene after app restart", async () => {
    await browser.pause(1500);

    // Accept consent and start lesson
    await $("#a").then((b) => b.click());
    await $("button*=Continuer").then((b) => b.click());
    await browser.pause(500);
    await $("a*=Démarrer").then((l) => l.click());
    await browser.pause(500);

    // Play 3 scenes
    for (let i = 0; i < 3; i++) {
      await browser.pause(600);
      const continueBtn = await $("button*=Continuer");
      if (await continueBtn.isExisting()) {
        await continueBtn.click();
      } else {
        const radio = await $("input[type=radio]");
        await radio.click();
        await $("button*=Soumettre").then((b) => b.click());
        await browser.pause(400);
        await $("button*=Continuer").then((b) => b.click());
      }
    }

    // Read current scene number before "restart"
    const sceneCounter = await $(".text-gray-500");
    const textBefore = await sceneCounter.getText();

    // Simulate "restart" by navigating away and back
    await browser.url("/");
    await browser.pause(1500);

    // Should skip consent (already given) and go to library
    expect(await browser.getUrl()).toContain("/library");

    // Re-enter lesson
    await $("a*=Démarrer").then((l) => l.click());
    await browser.pause(500);

    // State should be persisted — we may be past scene 1
    const sceneText = await $(".text-gray-500").then((el) => el.getText());
    expect(sceneText).toBeTruthy();
    // The scene counter should match what it was (persistence resumed)
    expect(sceneText).toBe(textBefore);
  });
});
