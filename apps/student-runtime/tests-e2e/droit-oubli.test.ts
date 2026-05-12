describe("Droit à l'oubli (right to erasure)", () => {
  it("wipes data and returns to consent on next bootstrap", async () => {
    await browser.pause(1500);

    // Accept consent first
    await $("#a").then((b) => b.click());
    await $("button*=Continuer").then((b) => b.click());
    await browser.pause(500);

    // Go to settings
    await $("a*=Réglages").then((l) => l.click());
    await browser.pause(500);

    // Click erase
    await $("button*=Effacer mes données").then((b) => b.click());
    await browser.pause(200);

    // Confirm
    await $("button*=Oui, tout effacer").then((b) => b.click());
    await browser.pause(800);

    // Should be back at /consent
    expect(await browser.getUrl()).toContain("/consent");

    // Refresh → bootstrap → should go to /consent again (no persisted consent)
    await browser.refresh();
    await browser.pause(1500);
    expect(await browser.getUrl()).toContain("/consent");
  });
});
