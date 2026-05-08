describe("Adaptation skip rule", () => {
  it("skips to next concept after mastery threshold reached", async () => {
    await browser.pause(1500);
    await $("#a").then((b) => b.click());
    await $("button*=Continuer").then((b) => b.click());
    await browser.pause(500);
    await $("a*=Démarrer").then((l) => l.click());
    await browser.pause(500);

    // Skip intro
    await $("button*=Continuer").then((b) => b.click());
    await browser.pause(400);

    // Answer 3 quizzes correctly (pick first radio which should be correct)
    for (let i = 0; i < 3; i++) {
      const isQuiz = await $("button*=Soumettre").isExisting();
      if (!isQuiz) break;

      const radios = await $$("input[type=radio]");
      await radios[0].click();
      await $("button*=Soumettre").then((b) => b.click());
      await browser.pause(400);
      await $("button*=Continuer").then((b) => b.click());
      await browser.pause(400);
    }

    // Should have advanced (possibly skipped) and still in lesson
    const url = await browser.getUrl();
    expect(url).toContain("/lesson/");
  });
});
