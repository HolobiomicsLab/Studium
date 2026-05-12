/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SettingsScreen from "./SettingsScreen";

afterEach(cleanup);

const { emitMock, flushMock } = vi.hoisted(() => ({
  emitMock: vi.fn(),
  flushMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../hooks/useTelemetry", () => ({
  useTelemetry: () => ({ emit: emitMock, flush: flushMock }),
  getTelemetryEndpoint: (x: string | null) => x,
  getTelemetryCourseToken: (x: string) => x,
}));

vi.mock("../lib/tauri", () => ({
  tauri: {
    getPseudonyme: vi.fn().mockResolvedValue("pseudo-test"),
    deleteAllData: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("SettingsScreen telemetry", () => {
  beforeEach(() => {
    emitMock.mockReset();
    flushMock.mockClear();
  });

  it("emits forget_requested when user confirms data deletion", async () => {
    render(
      <MemoryRouter>
        <SettingsScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /effacer mes données/i }));
    fireEvent.click(screen.getByRole("button", { name: /oui, tout effacer/i }));
    await waitFor(() => {
      const call = emitMock.mock.calls.find((c) => c[0].type === "forget_requested");
      expect(call).toBeTruthy();
    });
  });

  it("does not emit when user cancels the wipe confirmation", async () => {
    render(
      <MemoryRouter>
        <SettingsScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /effacer mes données/i }));
    fireEvent.click(screen.getByRole("button", { name: /annuler/i }));
    await Promise.resolve();
    const call = emitMock.mock.calls.find((c) => c[0].type === "forget_requested");
    expect(call).toBeUndefined();
  });
});
