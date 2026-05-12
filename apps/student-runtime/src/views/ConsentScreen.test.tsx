/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ConsentScreen from "./ConsentScreen";

afterEach(cleanup);

const { emitMock } = vi.hoisted(() => ({ emitMock: vi.fn() }));

vi.mock("../hooks/useTelemetry", () => ({
  useTelemetry: () => ({ emit: emitMock, flush: vi.fn() }),
  getTelemetryEndpoint: (x: string | null) => x,
  getTelemetryCourseToken: (x: string) => x,
}));

vi.mock("../lib/tauri", () => ({
  tauri: {
    setConsent: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("ConsentScreen telemetry", () => {
  beforeEach(() => {
    emitMock.mockReset();
  });

  it("emits consent_granted for scope A on submit when only A is granted", async () => {
    render(
      <MemoryRouter>
        <ConsentScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByLabelText(/A · Utilisation/));
    fireEvent.click(screen.getByRole("button", { name: /continuer/i }));
    await waitFor(() => {
      const scopes = emitMock.mock.calls
        .filter((c) => c[0].type === "consent_granted")
        .map((c) => c[0].scope);
      expect(scopes).toEqual(["A"]);
    });
  });

  it("emits consent_granted for A, B, and C when all granted", async () => {
    render(
      <MemoryRouter>
        <ConsentScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByLabelText(/A · Utilisation/));
    fireEvent.click(screen.getByLabelText(/B · Indicateurs/));
    fireEvent.click(screen.getByLabelText(/C · Activités/));
    fireEvent.click(screen.getByRole("button", { name: /continuer/i }));
    await waitFor(() => {
      const scopes = emitMock.mock.calls
        .filter((c) => c[0].type === "consent_granted")
        .map((c) => c[0].scope)
        .sort();
      expect(scopes).toEqual(["A", "B", "C"]);
    });
  });

  it("does not emit if A not granted (button disabled)", async () => {
    render(
      <MemoryRouter>
        <ConsentScreen />
      </MemoryRouter>,
    );
    const btn = screen.getByRole("button", { name: /continuer/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    await Promise.resolve();
    expect(emitMock).not.toHaveBeenCalled();
  });
});
