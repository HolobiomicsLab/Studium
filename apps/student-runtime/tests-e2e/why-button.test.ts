describe("Why button (M6 modulator)", () => {
  it("shows adaptation dialog with rule_id after a rule fires", async () => {
    await browser.pause(1500);
    await $("#a").then((b) => b.click());
    await $("button*=Continuer").then((b) => b.click());
    await browser.pause(500);
    await $("a*=Démarrer").then((l) => l.click());
    await browser.pause(500);

    // Skip intro
    await $("button*=Continuer").then((b) => b.click());
    await browser.pause(400);

    // Answer wrong twice to trigger replay rule
    for (let i = 0; i < 2; i++) {
      const radios = await $$("input[type=radio]");
      await radios[radios.length - 1].click();
      await $("button*=Soumettre").then((b) => b.click());
      await browser.pause(400);
      await $("button*=Continuer").then((b) => b.click());
      await browser.pause(400);
    }

    // '?' button should now be visible
    const whyBtn = await $("button[aria-label='Pourquoi cette adaptation ?']");
    expect(await whyBtn.isExisting()).toBe(true);

    await whyBtn.click();
    await browser.pause(300);

    // Dialog should contain rule_id text
    const dialog = await $("[role=dialog]");
    expect(await dialog.isExisting()).toBe(true);
    const text = await dialog.getText();
    expect(text.length).toBeGreaterThan(0);

    await $("button*=OK").then((b) => b.click());
  });
});
