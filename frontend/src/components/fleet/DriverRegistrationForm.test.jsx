import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const service = vi.hoisted(() => ({ checkDriverEmployeeNo: vi.fn() }));
vi.mock("../../services/fleet/driverService", () => ({
  ...service,
  DEFAULT_LICENSE_TYPE: "Professional",
  LICENSE_TYPES: ["Non-Professional", "Professional", "Student", "Conductor"],
}));
vi.mock("./LicenseScanner", () => ({
  default: ({ onScanned }) => (
    <button type="button" onClick={() => onScanned(
      new File(["licence"], "licence.jpg", { type: "image/jpeg" }),
      {
        status: "read", found: 4,
        fields: { firstName: "Maria", lastName: "Reyes", licenseNo: "N01-22-333333", licenseExpiry: "2030-04-10", licenseType: "Professional" },
        confidence: { firstName: "high", lastName: "high", licenseNo: "high", licenseExpiry: "low", licenseType: "high" },
      }
    )}>Read test licence</button>
  ),
}));

const { default: DriverRegistrationForm, generateDriverPin } = await import("./DriverRegistrationForm");

const enterAccess = () => {
  fireEvent.change(screen.getByLabelText("Employee Number *"), { target: { value: "EMP-204" } });
  fireEvent.change(screen.getByLabelText("PIN *"), { target: { value: "4821" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
};

describe("Driver registration workflow", () => {
  beforeEach(() => service.checkDriverEmployeeNo.mockReset().mockResolvedValue(true));

  it("starts with only Employee Number and PIN, and blocks a duplicate number", async () => {
    service.checkDriverEmployeeNo.mockResolvedValue(false);
    render(<DriverRegistrationForm onSave={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText("Employee Number *")).toBeRequired();
    expect(screen.getByLabelText("PIN *")).toBeRequired();
    expect(screen.queryByLabelText("First Name *")).toBeNull();

    enterAccess();
    expect(await screen.findByRole("alert")).toHaveTextContent("already belongs to another driver");
    expect(screen.queryByLabelText("First Name *")).toBeNull();
  });

  it("generates a four-digit PIN using a cryptographic source", () => {
    const pin = generateDriverPin({ getRandomValues: (values) => { values[0] = 123456; return values; } });
    expect(pin).toMatch(/^\d{4}$/);
  });

  it("lets the Admin correct OCR, requires explicit review, and saves credentials and licence together", async () => {
    const save = vi.fn().mockResolvedValue(true);
    render(<DriverRegistrationForm onSave={save} onCancel={vi.fn()} />);
    enterAccess();

    expect(await screen.findByLabelText("First Name *")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Read test licence" }));
    expect(screen.getByLabelText("License Number *")).toHaveValue("N01-22-333333");

    // OCR is a proposal: a human correction is allowed, but it invalidates any
    // earlier verification until the Admin checks the final value again.
    fireEvent.change(screen.getByLabelText("License Number *"), { target: { value: "N01-22-333338" } });
    fireEvent.change(screen.getByLabelText("Contact Number *"), { target: { value: "09171234567" } });
    const verify = screen.getByRole("checkbox");
    expect(verify).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save Driver" })).toBeDisabled();
    fireEvent.click(verify);
    fireEvent.click(screen.getByRole("button", { name: "Save Driver" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [profile, photo] = save.mock.calls[0];
    expect(profile).toMatchObject({
      employeeNo: "EMP-204", pin: "4821", firstName: "Maria", lastName: "Reyes",
      licenseNo: "N01-22-333338", licenseReviewed: true,
    });
    expect(photo).toBeInstanceOf(File);
  });
});
