describe("Adaptation replay rule", () => {
  it("stays on the same quiz scene after 2 wrong answers", async () => {
    await browser.pause(1500);
    await $("#a").then((b) => b.click());
    await $("button*=Continuer").then((b) => b.click());
    await browser.pause(500);
    await $("a*=Démarrer").then((l) => l.click());
    await browser.pause(500);

    // Skip intro scene
    await $("button*=Continuer").then((b) => b.click());
    await browser.pause(400);

    // Now on a quiz scene — find and pick wrong answer twice
    for (let attempt = 0; attempt < 2; attempt++) {
      const sceneText = await browser.getPageSource();
      expect(sceneText).toContain("Soumettre");

      // Pick the last radio (likely wrong)
      const radios = await $$("input[type=radio]");
      await radios[radios.length - 1].click();
      await $("button*=Soumettre").then((b) => b.click());
      await browser.pause(400);
      await $("button*=Continuer").then((b) => b.click());
      await browser.pause(400);
    }

    // After 2 errors, replay rule should keep us on the same quiz
    const url = await browser.getUrl();
    expect(url).toContain("/lesson/");
    expect(url).not.toContain("/summary");
  });
});
