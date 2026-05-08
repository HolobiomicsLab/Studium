describe("Consent flow", () => {
  it("requires level A to continue", async () => {
    await browser.pause(1500);
    const url = await browser.getUrl();
    expect(url).toContain("/consent");

    const continueBtn = await $("button*=Continuer");
    expect(await continueBtn.isEnabled()).toBe(false);

    const aBox = await $("#a");
    await aBox.click();
    expect(await continueBtn.isEnabled()).toBe(true);

    await continueBtn.click();
    await browser.pause(500);
    expect(await browser.getUrl()).toContain("/library");
  });
});
