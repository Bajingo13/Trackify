import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  driverDeviceStatus: vi.fn(),
  driverVerifyDevice: vi.fn(),
  driverNewRecoveryCodes: vi.fn(),
}));
vi.mock("./driverApi", () => api);

const { NewPhone, NewRecoveryCodes, RecoveryCodes } = await import("./DriverDeviceScreens");

/**
 * One trusted phone per driver. These are the screens a driver meets when
 * they sign in on a phone that is not it, and the codes that get them back in.
 */

const pending = { pendingToken: "pending.jwt", driver: { driverId: 4, name: "Jose" }, locked: false };

describe("recovery codes", () => {
  it("shows every code and does not carry on until the driver says they wrote them down", () => {
    const onDone = vi.fn();
    render(<RecoveryCodes codes={["ABCDE-FGHJK", "MNPQR-STUVW"]} onDone={onDone} />);
    expect(screen.getByText("ABCDE-FGHJK")).toBeInTheDocument();
    expect(screen.getByText("MNPQR-STUVW")).toBeInTheDocument();
    const go = screen.getByRole("button", { name: "Continue" });
    expect(go).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(go);
    expect(onDone).toHaveBeenCalled();
  });

  it("a new set from Profile asks for the PIN, then shows the codes", async () => {
    api.driverNewRecoveryCodes.mockResolvedValue({ recoveryCodes: ["22222-33333"] });
    render(<NewRecoveryCodes codesLeft={1} onDone={() => {}} />);
    expect(screen.getByText(/You have 1 unused code\./)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Enter your PIN"), { target: { value: "4826" } });
    fireEvent.click(screen.getByRole("button", { name: "Make new codes" }));
    expect(await screen.findByText("22222-33333")).toBeInTheDocument();
    expect(api.driverNewRecoveryCodes).toHaveBeenCalledWith("4826");
  });
});

describe("a new phone", () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

  it("a recovery code signs this phone in", async () => {
    api.driverVerifyDevice.mockResolvedValue({ token: "t", codesLeft: 7, lowCodes: false });
    api.driverDeviceStatus.mockResolvedValue({ status: "waiting" });
    const onSignedIn = vi.fn();
    render(<NewPhone pending={pending} onSignedIn={onSignedIn} onCancel={() => {}} />);
    const use = screen.getByRole("button", { name: "Use this phone" });
    expect(use).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: "abcde-fghjk" } });
    fireEvent.click(use);
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(api.driverVerifyDevice).toHaveBeenCalledWith("pending.jwt", "ABCDE-FGHJK");
    expect(onSignedIn.mock.calls[0][0]).toEqual({ token: "t", driver: pending.driver });
  });

  it("a wrong code says so, and how many tries are left when few are", async () => {
    api.driverDeviceStatus.mockResolvedValue({ status: "waiting" });
    api.driverVerifyDevice.mockRejectedValue(Object.assign(new Error("That code isn't right, or it has been used."), { status: 401, attemptsLeft: 2 }));
    render(<NewPhone pending={pending} onSignedIn={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: "ZZZZZ-ZZZZZ" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this phone" }));
    expect(await screen.findByText(/2 tries left/)).toBeInTheDocument();
  });

  it("locked out, the code box is gone and the driver is sent to the office", () => {
    api.driverDeviceStatus.mockResolvedValue({ status: "waiting" });
    render(<NewPhone pending={{ ...pending, locked: true }} onSignedIn={() => {}} onCancel={() => {}} />);
    expect(screen.queryByLabelText("Recovery code")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(/Call your office/);
  });

  it("signs in by itself once the office approves the phone", async () => {
    api.driverDeviceStatus.mockResolvedValue({ status: "approved", token: "from-office" });
    const onSignedIn = vi.fn();
    render(<NewPhone pending={pending} onSignedIn={onSignedIn} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /called my office/ }));
    expect(screen.getByRole("status")).toHaveTextContent(/Waiting for your office/);
    await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
    expect(onSignedIn).toHaveBeenCalledWith({ token: "from-office", driver: pending.driver }, expect.anything());
  });
});
