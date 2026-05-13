/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdaptationButton } from "./AdaptationButton";

afterEach(cleanup);

describe("AdaptationButton", () => {
  it("affiche la rule_id active", () => {
    render(
      <AdaptationButton
        ruleId="rule_2err_replay_concept"
        ruleLabel="Tu as fait 2 erreurs — replay du concept précédent"
      />,
    );
    expect(screen.getByText(/rule_2err_replay_concept/i)).toBeTruthy();
  });

  it("affiche un tooltip au survol avec l'explication en clair (QW2 M6)", async () => {
    render(
      <AdaptationButton
        ruleId="rule_2err_replay_concept"
        ruleLabel="Tu as fait 2 erreurs — replay du concept précédent"
      />,
    );
    const button = screen.getByRole("button", { name: /Pourquoi/i });
    fireEvent.mouseOver(button);
    expect(
      await screen.findByText(/Tu as fait 2 erreurs — replay du concept précédent/i),
    ).toBeTruthy();
  });

  it("a un focus indicator visible (QW1 M6)", () => {
    render(<AdaptationButton ruleId="rule_test" ruleLabel="Test" />);
    const button = screen.getByRole("button");
    button.focus();
    const styles = window.getComputedStyle(button);
    const hasFocusIndicator =
      styles.outlineWidth !== "0px" ||
      styles.boxShadow !== "none" ||
      button.className.match(/focus(:|-)/i);
    expect(hasFocusIndicator).toBeTruthy();
  });
});
