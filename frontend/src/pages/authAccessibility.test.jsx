import { beforeEach, describe, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expectNoAxeViolations } from "../test/axe";

const login = vi.fn();
const completeInitialPassword = vi.fn();
const acceptInvitation = vi.fn();
const logout = vi.fn();
const checkResetToken = vi.fn();
let user = null;

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user,
    login,
    completeInitialPassword,
    acceptInvitation,
    logout,
  }),
}));

vi.mock("../services/passwordResetService", () => ({
  checkResetToken: (...args) => checkResetToken(...args),
  completePasswordReset: vi.fn(),
  requestPasswordReset: vi.fn(),
  checkInvitation: vi.fn(),
  verifyInvitation: vi.fn(),
}));

vi.mock("../components/login/TrackingScene", () => ({
  default: () => <div aria-hidden="true" />,
}));

vi.mock("../components/login/TruckTraffic", () => ({
  default: () => <div aria-hidden="true" />,
}));

const { default: LoginPage } = await import("./LoginPage");
const { default: ResetPasswordPage } = await import("./ResetPasswordPage");
const { default: InitialPasswordGate } = await import("../components/auth/InitialPasswordGate");

// Axe inspects the complete rendered tree. Give it room on slower CI workers,
// especially when Vitest is running the rest of this large suite in parallel.
vi.setConfig({ testTimeout: 20_000 });

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderReset() {
  return render(
    <MemoryRouter initialEntries={["/reset-password?token=axe-test"]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  user = null;
  localStorage.clear();
  login.mockReset();
  completeInitialPassword.mockReset();
  acceptInvitation.mockReset();
  logout.mockReset();
  checkResetToken.mockReset();
  checkResetToken.mockResolvedValue({ success: true, data: { email: "a***@example.com" } });
});

describe("auth screens meet automated Axe checks", () => {
  test("sign-in screen", async () => {
    const { container } = renderLogin();

    await expectNoAxeViolations(container);
  });

  test("forgot-password screen inside sign-in", async () => {
    const { container } = renderLogin();
    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
    await screen.findByRole("heading", { name: /forgot your password/i });

    await expectNoAxeViolations(container);
  });

  test("reset-password screen", async () => {
    const { container } = renderReset();
    await screen.findByLabelText(/^new password$/i);

    await expectNoAxeViolations(container);
  });

  test("first-time password setup on sign-in", async () => {
    user = {
      email: "new.user@example.com",
      firstName: "Maria",
      lastName: "Santos",
      mustChangePassword: true,
    };
    const { container } = renderLogin();
    await screen.findByRole("heading", { name: /finish your account/i });

    await expectNoAxeViolations(container);
  });

  test("protected-route password gate", async () => {
    user = {
      email: "new.user@example.com",
      firstName: "Maria",
      lastName: "Santos",
      mustChangePassword: true,
    };
    const { container } = render(
      <InitialPasswordGate>
        <div>Private dashboard</div>
      </InitialPasswordGate>,
    );

    await expectNoAxeViolations(container);
  });
});
