import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const svc = vi.hoisted(() => ({
  getAllDrivers: vi.fn(), createDriver: vi.fn(), updateDriver: vi.fn(), deleteDriver: vi.fn(), reactivateDriver: vi.fn(),
  getDriverStats: vi.fn(), setDriverAppAccess: vi.fn(),
  getDriverLicensePhoto: vi.fn(), uploadDriverLicensePhoto: vi.fn(), deleteDriverLicensePhoto: vi.fn(),
  scanDriverLicense: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock("../../services/fleet/driverService", () => ({
  ...svc,
  DRIVER_STATUSES: ["Available", "On Trip", "Inactive"],
  LICENSE_TYPES: ["Non-Professional", "Professional", "Student", "Conductor"],
  DEFAULT_LICENSE_TYPE: "Professional",
}));
vi.mock("../../components/layout/AppShell", () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock("../../auth/permissions", () => ({ Can: ({ children }) => <>{children}</>, usePermissions: () => ({ can: () => true }) }));
vi.mock("../../components/shared/Toast", () => ({ useToast: () => ({ addToast: toast }) }));
vi.mock("../../services/fleet/prepareLicenceFile", () => ({ prepareLicenceFile: async (file) => file }));

const { default: DriversPage } = await import("./DriversPage");
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const driver = (over = {}) => ({
  id: 7, employeeNo: "DRV-007", firstName: "Juan", lastName: "Dela Cruz", contactNo: "0917", phone: "0917",
  licenseNo: "N01-12-345678", licenseType: "Professional", licenseExpiry: day(300), hasLicensePhoto: true,
  status: "Available", rawStatus: "active", appEnabled: true, hasPin: true,
  emergencyContact: { name: "", phone: "", relationship: "" }, certifications: [], ...over,
});
const page = (rows) => ({ data: rows, total: rows.length, page: 1, limit: 10, totalPages: 1 });
const stats = (licence = {}) => ({ total: 1, available: 1, onTrip: 0, inactive: 0, licence: { expired: 0, expiring: 0, ...licence } });
const photo = () => new File([new Uint8Array(40)], "card.jpg", { type: "image/jpeg" });

beforeEach(() => {
  Object.values(svc).forEach((fn) => fn.mockReset());
  toast.mockReset();
  svc.getAllDrivers.mockResolvedValue(page([driver()]));
  svc.getDriverStats.mockResolvedValue(stats());
  svc.getDriverLicensePhoto.mockResolvedValue(null);
  svc.updateDriver.mockResolvedValue({ success: true });
  svc.uploadDriverLicensePhoto.mockResolvedValue({ success: true });
  URL.createObjectURL = vi.fn(() => "blob:card");
  URL.revokeObjectURL = vi.fn();
});

describe("Driver registration entry point", () => {
  test("opens a single form with Account Access under the licence", async () => {
    render(<DriversPage />, { wrapper: MemoryRouter });
    fireEvent.click(await screen.findByRole("button", { name: /Add Driver/ }));
    expect(await screen.findByLabelText("PIN")).toHaveTextContent("Generated automatically on save");
    expect(screen.getByLabelText("Employee Number")).toHaveTextContent("Assigned automatically on save");
    expect(screen.getByLabelText("First Name *")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });
});

describe("Driver App PIN actions", () => {
  test("sizes every action to its label instead of stretching across the modal", async () => {
    svc.getAllDrivers.mockResolvedValue(page([driver({ email: "juan@gmail.com" })]));
    render(<DriversPage />, { wrapper: MemoryRouter });
    fireEvent.click(await screen.findByTitle("Driver App PIN"));

    expect(await screen.findByRole("button", { name: "Email a new PIN" })).toHaveStyle({ width: "fit-content" });
    expect(screen.getByRole("button", { name: "Disable app access" })).toHaveStyle({ width: "fit-content", flex: "0 0 auto" });
    expect(screen.getByRole("button", { name: "Set PIN" })).toHaveStyle({ width: "fit-content", flex: "0 0 auto" });
  });
});

describe("Employee Numbers are system-assigned", () => {
  test("the edit form shows the number but offers no way to change it", async () => {
    render(<DriversPage />, { wrapper: MemoryRouter });
    fireEvent.click(await screen.findByTitle("Edit"));
    const shown = await screen.findByLabelText("Employee Number");
    expect(shown).toHaveTextContent("DRV-007");
    expect(shown.tagName).not.toBe("INPUT");
    expect(screen.queryByDisplayValue("DRV-007")).toBeNull();
  });
});

describe("licence monitoring in the driver list", () => {
  test("shows precise warning and expired states", async () => {
    svc.getAllDrivers.mockResolvedValue(page([
      driver({ id: 1, firstName: "Ana", licenseExpiry: day(12) }),
      driver({ id: 2, firstName: "Ben", licenseExpiry: day(-3) }),
    ]));
    render(<DriversPage />, { wrapper: MemoryRouter });
    const row = async (name) => (await screen.findByText(new RegExp(`^${name} `))).closest("tr");
    expect(within(await row("Ana")).getByText("Expires in 12 days")).toBeInTheDocument();
    expect(within(await row("Ben")).getByText("Expired 3 days ago")).toBeInTheDocument();
  });

  test("attention counts filter the list", async () => {
    svc.getDriverStats.mockResolvedValue(stats({ expired: 2, expiring: 3 }));
    render(<DriversPage />, { wrapper: MemoryRouter });
    const banner = (await screen.findByText("Driver licences need attention:")).parentElement;
    expect(within(banner).getByText("2 expired")).toBeInTheDocument();
    svc.getAllDrivers.mockClear();
    fireEvent.click(within(banner).getByText("2 expired"));
    await waitFor(() => expect(svc.getAllDrivers).toHaveBeenCalledWith(expect.objectContaining({ licenseStatus: "Expired" })));
  });
});

describe("authorized licence maintenance", () => {
  async function openDetail(row = driver()) {
    svc.getAllDrivers.mockResolvedValue(page([row]));
    render(<DriversPage />, { wrapper: MemoryRouter });
    fireEvent.click(await screen.findByTitle("View"));
    await screen.findByText("License Information");
  }

  test("an expired licence is clearly called out", async () => {
    await openDetail(driver({ licenseExpiry: day(-5) }));
    expect(screen.getByText("Licence expired.")).toBeInTheDocument();
    expect(screen.getByText(/cannot be assigned to trips/)).toBeInTheDocument();
  });

  test("a readable renewal offers changes and applies them only after confirmation", async () => {
    svc.scanDriverLicense.mockResolvedValue({
      status: "read", found: 4,
      fields: { firstName: "Juan", lastName: "Dela Cruz", licenseNo: "N01-12-345678", licenseType: "Professional", licenseExpiry: "2031-06-30" },
      confidence: {},
    });
    await openDetail(driver({ licenseExpiry: day(-20) }));
    const file = photo();
    fireEvent.change(screen.getByLabelText("Licence photo"), { target: { files: [file] } });
    await waitFor(() => expect(svc.uploadDriverLicensePhoto).toHaveBeenCalledWith(7, file));
    expect(svc.updateDriver).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Update the record" }));
    await waitFor(() => expect(svc.updateDriver).toHaveBeenCalledWith(7, { licenseExpiry: "2031-06-30" }));
  });

  test("an unreadable replacement is rejected and never stored", async () => {
    svc.scanDriverLicense.mockResolvedValue({ status: "not_a_licence", message: "That does not look like a driver's licence." });
    await openDetail();
    fireEvent.change(screen.getByLabelText("Licence photo"), { target: { files: [photo()] } });
    await waitFor(() => expect(toast).toHaveBeenCalledWith("That does not look like a driver's licence.", "error"));
    expect(svc.uploadDriverLicensePhoto).not.toHaveBeenCalled();
  });

  test("an existing missing licence type still displays the office default", async () => {
    svc.getAllDrivers.mockResolvedValue(page([driver({ licenseType: "" })]));
    render(<DriversPage />, { wrapper: MemoryRouter });
    fireEvent.click(await screen.findByTitle("Edit"));
    await screen.findByLabelText("Licence photo");
    expect(screen.getByText("License Type").parentElement).toHaveTextContent("Professional");
  });
});

describe("bringing a deactivated driver back", () => {
  test("an inactive driver offers Reactivate instead of Deactivate, and it asks first", async () => {
    svc.getAllDrivers.mockResolvedValue(page([driver({ status: "Inactive", rawStatus: "inactive" })]));
    svc.reactivateDriver.mockResolvedValue({ success: true });
    render(<DriversPage />, { wrapper: MemoryRouter });

    const button = await screen.findByRole("button", { name: "Reactivate Juan Dela Cruz" });
    expect(screen.queryByTitle("Deactivate")).toBeNull();
    fireEvent.click(button);
    expect(await screen.findByText(/They keep their Employee Number and PIN/)).toBeInTheDocument();
    expect(svc.reactivateDriver).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reactivate" }));
    await waitFor(() => expect(svc.reactivateDriver).toHaveBeenCalledWith(7));
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Juan Dela Cruz reactivated/), "success");
  });

  test("an active driver still offers Deactivate, not Reactivate", async () => {
    render(<DriversPage />, { wrapper: MemoryRouter });
    expect(await screen.findByTitle("Deactivate")).toBeInTheDocument();
    expect(screen.queryByTitle("Reactivate")).toBeNull();
  });

  test("a refused reactivation says why", async () => {
    svc.getAllDrivers.mockResolvedValue(page([driver({ status: "Inactive", rawStatus: "inactive" })]));
    svc.reactivateDriver.mockResolvedValue({ success: false, message: "Driver not found." });
    render(<DriversPage />, { wrapper: MemoryRouter });
    fireEvent.click(await screen.findByRole("button", { name: "Reactivate Juan Dela Cruz" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reactivate" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Driver not found.", "error"));
  });
});

describe("editing a licence expiry", () => {
  test("a year no licence could have is flagged, and Update is held back", async () => {
    render(<DriversPage />, { wrapper: MemoryRouter });
    fireEvent.click(await screen.findByTitle("Edit"));
    const expiry = await screen.findByLabelText("License Expiry");
    fireEvent.change(expiry, { target: { value: "1927-01-01" } });

    expect(screen.getByText(/is not plausible\. Check the year\./)).toBeInTheDocument();
    const update = screen.getAllByRole("button", { name: "Update" }).find((b) => b.closest("form"));
    expect(update).toBeDisabled();
    fireEvent.submit(update.closest("form"));
    expect(svc.updateDriver).not.toHaveBeenCalled();
  });
});

describe("an expiry already on file", () => {
  test("is not re-judged when something else is edited", async () => {
    svc.getAllDrivers.mockResolvedValue(page([driver({ licenseExpiry: "2045-01-01" })]));
    render(<DriversPage />, { wrapper: MemoryRouter });
    fireEvent.click(await screen.findByTitle("Edit"));
    const expiry = await screen.findByLabelText("License Expiry");
    expect(screen.queryByText(/is not possible/)).toBeNull();
    expect(expiry).not.toHaveAttribute("max");
    const update = screen.getAllByRole("button", { name: "Update" }).find((b) => b.closest("form"));
    expect(update).toBeEnabled();
  });
});
