import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  me: null,
  uploadLicence: vi.fn(),
  removeLicence: vi.fn(),
}));

vi.mock("./driverApi", () => ({
  driverMe: () => Promise.resolve(state.me),
  driverUpdateMe: vi.fn(),
  driverUploadPhoto: vi.fn(),
  driverRemovePhoto: vi.fn(),
  driverUploadLicensePhoto: (...a) => state.uploadLicence(...a),
  driverRemoveLicensePhoto: (...a) => state.removeLicence(...a),
  driverBlobUrl: () => Promise.resolve(null),
}));
vi.mock("./native", () => ({ tap: () => {}, notifySuccess: () => {} }));

const { default: DriverProfile } = await import("./DriverProfile");

/**
 * The driver's "Me" tab.
 *
 * This screen shipped rendering nothing at all: the licence card was handed an
 * onChange that did not exist, so opening the tab threw before anything was
 * drawn. No test rendered it. These do.
 */

const profile = (licence = {}) => ({
  driverId: 4, employeeNo: "DRV-004", name: "Jose Garcia", firstName: "Jose", lastName: "Garcia",
  phone: "0917 000 0000",
  license: { no: "N01-23-456789", type: "Professional", expiry: "2027-05-01", daysLeft: 580, hasPhoto: false, photoUpdatedAt: null, ...licence },
  emergency: { name: "", phone: "", relation: "" },
  branch: "Davao Branch", branchCode: "DVO", company: "AstreaBlue Logistics", status: "active",
  since: "2026-01-10", hasPhoto: false, photoUpdatedAt: null, totals: { trips: 12, km: 3400 },
});

describe("driver profile", () => {
  beforeEach(() => {
    state.me = profile();
    state.uploadLicence.mockReset();
    state.removeLicence.mockReset();
  });

  it("renders the driver's details and licence", async () => {
    render(<DriverProfile onSignOut={() => {}} />);
    expect(await screen.findByText("N01-23-456789")).toBeInTheDocument();
    expect(screen.getByText(/Driver.s licence/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("shows a newly photographed licence straight away", async () => {
    state.uploadLicence.mockResolvedValue(profile({ hasPhoto: true, photoUpdatedAt: "2026-09-27T12:00:00Z" }));
    const { container } = render(<DriverProfile onSignOut={() => {}} />);
    await screen.findByText("N01-23-456789");

    const licenceCard = container.querySelector(".dr-lic");
    const galleryInput = licenceCard.querySelectorAll('input[type="file"]')[1];
    const file = new File([new Uint8Array(200)], "licence.pdf", { type: "application/pdf" });
    fireEvent.change(galleryInput, { target: { files: [file] } });

    await waitFor(() => expect(state.uploadLicence).toHaveBeenCalledTimes(1));
    // The refreshed profile came back through onChange: the card now offers Retake and Remove.
    expect(await screen.findByRole("button", { name: "Retake" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("removing the licence photo updates the card", async () => {
    state.me = profile({ hasPhoto: true });
    state.removeLicence.mockResolvedValue(profile({ hasPhoto: false }));
    render(<DriverProfile onSignOut={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(await screen.findByText("No photo yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });
});
