import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const completeInitialPassword = vi.fn();
let user = { mustChangePassword: true };

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user, completeInitialPassword }),
}));

const { default: InitialPasswordGate } = await import("./InitialPasswordGate");

describe("first-login password gate", () => {
  test("temporary-password users cannot see the application behind the gate", () => {
    user = { mustChangePassword: true };
    render(<InitialPasswordGate><div>Private dashboard</div></InitialPasswordGate>);
    expect(screen.queryByText("Private dashboard")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /create your permanent password/i })).toBeInTheDocument();
  });

  test("a mismatched confirmation never reaches the activation endpoint", () => {
    user = { mustChangePassword: true };
    render(<InitialPasswordGate><div>Private dashboard</div></InitialPasswordGate>);
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: "a safe phrase here" } });
    fireEvent.change(screen.getByLabelText(/repeat new password/i), { target: { value: "a different phrase" } });
    fireEvent.click(screen.getByRole("button", { name: /activate account/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/do not match/i);
    expect(completeInitialPassword).not.toHaveBeenCalled();
  });

  test("matching values are sent once for activation", async () => {
    user = { mustChangePassword: true };
    completeInitialPassword.mockResolvedValueOnce({ success: true });
    render(<InitialPasswordGate><div>Private dashboard</div></InitialPasswordGate>);
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: "a safe phrase here" } });
    fireEvent.change(screen.getByLabelText(/repeat new password/i), { target: { value: "a safe phrase here" } });
    fireEvent.click(screen.getByRole("button", { name: /activate account/i }));
    await waitFor(() => expect(completeInitialPassword).toHaveBeenCalledWith("a safe phrase here"));
  });

  test("activated users see the protected application", () => {
    user = { mustChangePassword: false };
    render(<InitialPasswordGate><div>Private dashboard</div></InitialPasswordGate>);
    expect(screen.getByText("Private dashboard")).toBeInTheDocument();
  });
});
