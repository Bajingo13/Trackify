import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  me: null,
  trips: [],
  meError: null,
  tripsError: null,
  updateMe: vi.fn(),
  uploadLicence: vi.fn(),
  removeLicence: vi.fn(),
}));

vi.mock("./driverApi", () => ({
  driverMe: () => state.meError ? Promise.reject(state.meError) : Promise.resolve(state.me),
  driverTrips: () => state.tripsError ? Promise.reject(state.tripsError) : Promise.resolve(state.trips),
  driverUpdateMe: (...a) => state.updateMe(...a),
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
    state.trips = [{ id: 31, status: "assigned", vehicle: "ABC-1234", vehicleType: "6-Wheeler" }];
    state.meError = null;
    state.tripsError = null;
    state.updateMe.mockReset();
    state.uploadLicence.mockReset();
    state.removeLicence.mockReset();
  });

  it("renders the identity card and organized profile overview", async () => {
    const { container } = render(<DriverProfile onSignOut={() => {}} onOpenHistory={() => {}} />);
    expect(await screen.findByText("Jose Garcia")).toBeInTheDocument();
    expect(screen.getByText("DRV-004")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Documents & Compliance" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Work Information" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Other" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Profile completion" })).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByRole("button", { name: /^Sign out/ })).toBeInTheDocument();
    expect(screen.queryByText("N01-23-456789")).toBeNull();

    const portrait = container.querySelector(".dr-me-face");
    const identity = container.querySelector(".dr-me-who");
    expect(portrait.compareDocumentPosition(identity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Driver's licence/ }));
    expect(await screen.findByText("N01-23-456789")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to profile" }));
    expect(await screen.findByRole("heading", { name: "Documents & Compliance" })).toBeInTheDocument();
  });

  it("does not invent unsupported profile features", async () => {
    render(<DriverProfile onSignOut={() => {}} onOpenHistory={() => {}} />);
    await screen.findByText("Jose Garcia");
    expect(screen.queryByText("Medical certificate")).toBeNull();
    expect(screen.queryByText("Notification preferences")).toBeNull();
    expect(screen.queryByText(/PIN \/ Security/i)).toBeNull();
  });

  it("turns profile completion into a clear next action", async () => {
    render(<DriverProfile onSignOut={() => {}} />);
    expect(await screen.findByText("Next: Add an emergency contact.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add now" }));
    expect(await screen.findByText("Who the office should call")).toBeInTheDocument();
  });

  it("keeps camera and gallery choices behind one clear picture action", async () => {
    render(<DriverProfile onSignOut={() => {}} />);
    const edit = await screen.findByRole("button", { name: "Add picture" });
    const identity = edit.closest(".dr-me-card");

    expect(identity.querySelector(".dr-photo-menu")).toBeNull();
    fireEvent.click(edit);

    expect(edit).toHaveAttribute("aria-expanded", "true");
    expect(within(identity).getByRole("button", { name: "Take photo" })).toBeInTheDocument();
    expect(within(identity).getByRole("button", { name: "Choose from gallery" })).toBeInTheDocument();
  });

  it("shows a newly photographed licence straight away", async () => {
    state.uploadLicence.mockResolvedValue(profile({ hasPhoto: true, photoUpdatedAt: "2026-09-27T12:00:00Z" }));
    const { container } = render(<DriverProfile onSignOut={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Driver's licence/ }));
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
    fireEvent.click(await screen.findByRole("button", { name: /Driver's licence/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(await screen.findByText("No photo yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("keeps personal edits on their own detail screen", async () => {
    state.updateMe.mockResolvedValue(profile());
    render(<DriverProfile onSignOut={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Personal information/ }));

    const phone = screen.getByLabelText("Your mobile number");
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    fireEvent.change(phone, { target: { value: "0999 123 4567" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(state.updateMe).toHaveBeenCalledWith({ phone: "0999 123 4567" }));
    expect(screen.getByText("Full name")).toBeInTheDocument();
    expect(screen.getByText("Driver ID")).toBeInTheDocument();
  });

  it("preserves every emergency-contact field and save action", async () => {
    state.updateMe.mockResolvedValue(profile());
    render(<DriverProfile onSignOut={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Emergency contact/ }));

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ana Garcia" } });
    fireEvent.change(screen.getByLabelText("Their number"), { target: { value: "0918 111 2222" } });
    fireEvent.change(screen.getByLabelText("Relation"), { target: { value: "Spouse" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(state.updateMe).toHaveBeenCalledWith({
      emergencyName: "Ana Garcia",
      emergencyPhone: "0918 111 2222",
      emergencyRelation: "Spouse",
    }));
  });

  it("opens the existing History destination from the work section", async () => {
    const openHistory = vi.fn();
    render(<DriverProfile onSignOut={() => {}} onOpenHistory={openHistory} />);
    fireEvent.click(await screen.findByRole("button", { name: /Trip history/ }));
    expect(openHistory).toHaveBeenCalledTimes(1);
  });

  it("reuses the current trip for assigned-vehicle work information", async () => {
    render(<DriverProfile onSignOut={() => {}} />);
    expect(await screen.findByText("ABC-1234 · 6-Wheeler")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Assigned vehicle/ }));
    expect(await screen.findByText("ABC-1234")).toBeInTheDocument();
    expect(screen.getByText("6-Wheeler")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
  });

  it("does not describe a failed assignment lookup as no assignment", async () => {
    state.tripsError = new Error("offline");
    render(<DriverProfile onSignOut={() => {}} />);
    expect(await screen.findByText("Assignment temporarily unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No current vehicle assigned")).toBeNull();
  });

  it("offers a working retry when the profile cannot load", async () => {
    state.meError = new Error("Connection lost");
    render(<DriverProfile onSignOut={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Couldn’t load your profile" })).toBeInTheDocument();
    expect(screen.getByText("Connection lost")).toBeInTheDocument();

    state.meError = null;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Jose Garcia")).toBeInTheDocument();
  });
});
