import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../services/fleet/driverService", () => ({
  DEFAULT_LICENSE_TYPE: "Professional",
  LICENSE_TYPES: ["Non-Professional", "Professional", "Student", "Conductor"],
}));
const scanExtra = vi.hoisted(() => ({ value: {} }));
vi.mock("./LicenseScanner", () => ({
  default: ({ onScanned }) => (
    <button type="button" onClick={() => onScanned(
      new File(["licence"], "licence.jpg", { type: "image/jpeg" }),
      {
        ...scanExtra.value,
        status: "read", found: 4,
        fields: { firstName: "Maria", lastName: "Reyes", licenseNo: "N01-22-333333", licenseExpiry: "2030-04-10", licenseType: "Professional" },
        confidence: { firstName: "high", lastName: "high", licenseNo: "high", licenseExpiry: "low", licenseType: "high" },
      }
    )}>Read test licence</button>
  ),
}));

const { default: DriverRegistrationForm, generateDriverPin } = await import("./DriverRegistrationForm");

const enterPin = (value = "4821") => fireEvent.change(screen.getByLabelText("PIN *"), { target: { value } });

// Scan, complete the remaining required field and tick the review box.
const fillAndVerify = () => {
  fireEvent.click(screen.getByRole("button", { name: "Read test licence" }));
  fireEvent.change(screen.getByLabelText("Contact Number *"), { target: { value: "09171234567" } });
  fireEvent.click(screen.getByRole("checkbox"));
};

describe("Driver registration workflow", () => {
  beforeEach(() => { scanExtra.value = {}; });

  it("is one form: no separate Account access step", () => {
    render(<DriverRegistrationForm onSave={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.getByLabelText("First Name *")).toBeInTheDocument();
    expect(screen.getByLabelText("License Number *")).toBeInTheDocument();
    expect(screen.getByLabelText("PIN *")).toBeRequired();
  });

  it("puts Account Access under the licence fields, with the Employee Number assigned by the system", () => {
    render(<DriverRegistrationForm onSave={vi.fn()} onCancel={vi.fn()} />);

    const expiry = screen.getByLabelText("License Expiry *");
    const heading = screen.getByRole("heading", { name: "Account Access" });
    const emergency = screen.getByRole("heading", { name: "Emergency Contact" });
    // DOCUMENT_POSITION_FOLLOWING = 4
    expect(expiry.compareDocumentPosition(heading) & 4).toBeTruthy();
    expect(heading.compareDocumentPosition(screen.getByLabelText("PIN *")) & 4).toBeTruthy();
    expect(heading.compareDocumentPosition(emergency) & 4).toBeTruthy();

    expect(screen.queryByLabelText("Employee Number *")).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Employee Number/ })).toBeNull();
    expect(screen.getByLabelText("Employee Number")).toHaveTextContent("Assigned automatically on save");
  });

  it("will not save without a valid PIN, even once the licence is verified", async () => {
    const save = vi.fn().mockResolvedValue(true);
    render(<DriverRegistrationForm onSave={save} onCancel={vi.fn()} />);
    enterPin("12");
    fillAndVerify();

    expect(screen.getByText("PIN must be 4 to 6 digits.")).toBeInTheDocument();
    expect(screen.getByText("Set a 4 to 6 digit PIN under Account Access to save.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Driver" })).toBeDisabled();

    enterPin("4821");
    expect(screen.getByRole("button", { name: "Save Driver" })).toBeEnabled();
  });

  it("Generate fills a PIN and shows it", () => {
    render(<DriverRegistrationForm onSave={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    const pin = screen.getByLabelText("PIN *");
    expect(pin.value).toMatch(/^\d{4}$/);
    expect(pin).toHaveAttribute("type", "text");
  });

  it("generates a four-digit PIN using a cryptographic source", () => {
    const pin = generateDriverPin({ getRandomValues: (values) => { values[0] = 123456; return values; } });
    expect(pin).toMatch(/^\d{4}$/);
  });

  it("lets the Admin correct OCR, requires explicit review, and saves credentials and licence together", async () => {
    const save = vi.fn().mockResolvedValue(true);
    render(<DriverRegistrationForm onSave={save} onCancel={vi.fn()} />);
    enterPin();

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
      pin: "4821", firstName: "Maria", lastName: "Reyes",
      licenseNo: "N01-22-333338", licenseReviewed: true,
    });
    expect(photo).toBeInstanceOf(File);
    expect(profile).not.toHaveProperty("employeeNo");
  });
});

describe("a licence another driver already holds", () => {
  beforeEach(() => { scanExtra.value = {}; });

  it("is recognised however the number is typed, and blocks saving", () => {
    scanExtra.value = { duplicateOf: { driverId: 5, name: "Pedro Santos", employeeNo: "DRV-005", inactive: false } };
    render(<DriverRegistrationForm onSave={vi.fn()} onCancel={vi.fn()} />);
    enterPin();
    fireEvent.click(screen.getByRole("button", { name: "Read test licence" }));
    fireEvent.change(screen.getByLabelText("License Number *"), { target: { value: "n01 22 333333" } });

    expect(screen.getByText(/Already belongs to Pedro Santos \(DRV-005\)/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save Driver" })).toBeDisabled();
  });

  it("held by an inactive driver, it points to Reactivate", () => {
    scanExtra.value = { duplicateOf: { driverId: 5, name: "Pedro Santos", employeeNo: "DRV-005", inactive: true } };
    render(<DriverRegistrationForm onSave={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Read test licence" }));
    expect(screen.getByText(/who is inactive\. Reactivate them from the driver list instead\./)).toBeInTheDocument();
  });
});

describe("a licence expiry no licence could have", () => {
  beforeEach(() => { scanExtra.value = {}; });

  it("is flagged on the field, and the driver cannot be verified or saved", () => {
    render(<DriverRegistrationForm onSave={vi.fn()} onCancel={vi.fn()} />);
    enterPin();
    fireEvent.click(screen.getByRole("button", { name: "Read test licence" }));
    fireEvent.change(screen.getByLabelText("Contact Number *"), { target: { value: "09171234567" } });
    fireEvent.change(screen.getByLabelText("License Expiry *"), { target: { value: "2099-04-10" } });

    expect(screen.getByText(/is not possible \(licences run for at most ten years\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("License Expiry *")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save Driver" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("License Expiry *"), { target: { value: "2029-04-10" } });
    expect(screen.queryByText(/is not possible/)).toBeNull();
    expect(screen.getByRole("checkbox")).toBeEnabled();
  });
});
