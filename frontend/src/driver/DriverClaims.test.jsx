import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setNet } from "./netStatus";

vi.mock("./netStatus", () => import("./netStatus.mock"));

const state = vi.hoisted(() => ({
  claims: { rows: [], totals: { waiting: 0, approved: 0, paid: 0, rejected: 0 } },
  trips: [],
  submit: vi.fn(),
  scan: vi.fn(),
}));

vi.mock("./driverApi", () => ({
  driverAllExpenses: () => Promise.resolve(state.claims),
  driverTrips: () => Promise.resolve(state.trips),
  driverSubmitExpense: (...args) => state.submit(...args),
  driverScanReceipt: (...args) => state.scan(...args),
}));
// The real picker opens the camera or gallery; the form only needs a file handed to it.
vi.mock("./PhotoPick", () => ({
  default: ({ onFile }) => (
    <button type="button" onClick={() => onFile(new File(["x"], "receipt.jpg", { type: "image/jpeg" }))}>Take photo</button>
  ),
}));

const { default: DriverClaims, filterClaims } = await import("./DriverClaims");
const { default: DriverClaimForm } = await import("./DriverClaimForm");

const claim = (id, extra = {}) => ({
  id, tripTicketId: 1, ticketNo: "TT-0001", category: "fuel", description: null, amount: 1000,
  expenseDate: "2026-09-18", receiptNo: null, status: "submitted", reviewNote: null, reviewedAt: null,
  hasReceipt: true, createdAt: "2026-09-18T07:00:00Z", ...extra,
});

describe("Claims", () => {
  beforeEach(() => {
    state.claims = {
      rows: [
        claim(4, { category: "fuel", amount: 2500, description: "Diesel top-up" }),
        claim(3, { category: "toll", status: "recorded" }),
        claim(2, { category: "parking", status: "rejected", reviewNote: "Receipt is not readable.", hasReceipt: false }),
        claim(1, { category: "meals", status: "reimbursed" }),
      ],
      totals: { waiting: 2500, approved: 1000, paid: 1000, rejected: 1000 },
    };
    state.trips = [];
    state.submit.mockReset();
  });

  it("explains how claims work and offers to file one when there are none", async () => {
    state.claims = { rows: [], totals: { waiting: 0, approved: 0, paid: 0, rejected: 0 } };
    const onDetail = vi.fn();
    render(<DriverClaims detail={null} onDetail={onDetail} />);
    expect(await screen.findByText("No claims yet")).toBeInTheDocument();
    expect(screen.getByText(/Attach a photo of the receipt/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit a claim" }));
    expect(onDetail).toHaveBeenCalledWith({ compose: true });
  });

  it("counts claims by what happened to them, from the records it has", async () => {
    render(<DriverClaims detail={null} onDetail={() => {}} />);
    await screen.findByText("Still to come back to you");
    // "Approved" is also a status badge on a row, so look only inside the tiles.
    const tiles = document.querySelector(".dr-stats-4");
    const tile = (label) => [...tiles.querySelectorAll(".dr-stat")].find((t) => t.textContent.startsWith(label)).textContent;
    expect(tile("Total")).toContain("4");
    expect(tile("Pending")).toContain("1");
    expect(tile("Approved")).toContain("2"); // approved, and paid back
    expect(tile("Rejected")).toContain("1");
  });

  it("shows why a claim was turned down on the row itself", async () => {
    render(<DriverClaims detail={null} onDetail={() => {}} />);
    expect(await screen.findByText("Receipt is not readable.")).toBeInTheDocument();
  });

  it("searches and filters, and says when nothing matches", async () => {
    render(<DriverClaims detail={null} onDetail={() => {}} />);
    await screen.findByText("Still to come back to you");
    fireEvent.change(screen.getByLabelText("Search your claims"), { target: { value: "diesel" } });
    expect(screen.getByRole("button", { name: /^Fuel,/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Toll,/ })).toBeNull();

    fireEvent.change(screen.getByLabelText("Search your claims"), { target: { value: "zzz" } });
    expect(screen.getByText("No claims match")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Not approved" }));
    expect(screen.getByRole("button", { name: /^Parking,/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Fuel,/ })).toBeNull();
  });

  it("opens a claim, with the finance remarks and without any receipt it cannot show", async () => {
    const onDetail = vi.fn();
    const { rerender } = render(<DriverClaims detail={null} onDetail={onDetail} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Parking,/ }));
    const opened = onDetail.mock.calls[0][0];
    expect(opened.claim.id).toBe(2);

    rerender(<DriverClaims detail={opened} onDetail={onDetail} />);
    expect(await screen.findByText("Finance remarks")).toBeInTheDocument();
    expect(screen.getAllByText("Receipt is not readable.").length).toBeGreaterThan(0);
    expect(screen.getByText("None attached")).toBeInTheDocument();
    expect(screen.getByText("Finance did not approve this claim.")).toBeInTheDocument();
  });
});

describe("filterClaims", () => {
  const rows = [claim(1, { category: "fuel", amount: 2500.5 }), claim(2, { category: "toll", status: "rejected", ticketNo: "TT-0099" })];
  const ids = (f) => filterClaims(rows, f).map((r) => r.id);
  it("matches category, run and amount; status and category narrow", () => {
    expect(ids({ query: "toll" })).toEqual([2]);
    expect(ids({ query: "0099" })).toEqual([2]);
    expect(ids({ query: "2500" })).toEqual([1]);
    expect(ids({ status: "rejected" })).toEqual([2]);
    expect(ids({ category: "fuel" })).toEqual([1]);
    expect(ids({})).toEqual([1, 2]);
  });
});

describe("the claim form", () => {
  beforeEach(() => {
    setNet("online");
    state.trips = [{ id: 11, ticketNo: "TT-0011", status: "in_transit", destination: "Digos, Davao del Sur" }];
    state.submit.mockReset().mockResolvedValue({ data: { id: 9 } });
    state.scan.mockReset();
  });

  it("offers only runs the server will accept a claim against", async () => {
    state.trips = [
      { id: 1, ticketNo: "TT-0001", status: "assigned", destination: "A" },
      { id: 2, ticketNo: "TT-0002", status: "released", destination: "B" },
      { id: 3, ticketNo: "TT-0003", status: "delivered", destination: "C" },
    ];
    render(<DriverClaimForm onBack={() => {}} onDone={() => {}} />);
    await screen.findByRole("radio", { name: /TT-0002/ });
    expect(screen.getByRole("radio", { name: /TT-0003/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /TT-0001/ })).toBeNull();
  });

  it("says so, and does not offer a form to fill, when no run can take a claim", async () => {
    state.trips = [{ id: 1, ticketNo: "TT-0001", status: "assigned" }];
    render(<DriverClaimForm onBack={() => {}} onDone={() => {}} />);
    expect(await screen.findByText(/once a run has been released/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit claim" })).toBeDisabled();
  });

  it("names what is missing and sends nothing", async () => {
    state.trips = [
      { id: 2, ticketNo: "TT-0002", status: "released", destination: "B" },
      { id: 3, ticketNo: "TT-0003", status: "released", destination: "C" },
    ];
    render(<DriverClaimForm onBack={() => {}} onDone={() => {}} />);
    await screen.findByRole("radio", { name: /TT-0002/ });
    fireEvent.click(screen.getByRole("button", { name: "Submit claim" }));
    expect(screen.getByText("Choose the run this expense belongs to.")).toBeInTheDocument();
    expect(screen.getByText("Choose what the expense was for.")).toBeInTheDocument();
    expect(screen.getByText("Enter how much you spent.")).toBeInTheDocument();
    expect(state.submit).not.toHaveBeenCalled();
  });

  it("refuses a date in the future and an amount the server would refuse", async () => {
    render(<DriverClaimForm onBack={() => {}} onDone={() => {}} />);
    await screen.findByRole("button", { name: "Fuel" });
    fireEvent.click(screen.getByRole("button", { name: "Fuel" }));
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "2000000" } });
    fireEvent.change(screen.getByLabelText(/Date/), { target: { value: "2999-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit claim" }));
    expect(screen.getByText(/looks wrong/)).toBeInTheDocument();
    expect(screen.getByText("The date cannot be in the future.")).toBeInTheDocument();
    expect(state.submit).not.toHaveBeenCalled();
  });

  it("typed in by hand: sends the claim with its date and receipt, then confirms it", async () => {
    const onDone = vi.fn();
    render(<DriverClaimForm onBack={() => {}} onDone={onDone} />);
    await screen.findByRole("button", { name: "Fuel" });
    fireEvent.click(screen.getByRole("radio", { name: "Type it in" }));
    fireEvent.click(screen.getByRole("button", { name: "Fuel" }));
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "1850.5" } });
    fireEvent.change(screen.getByLabelText(/Date/), { target: { value: "2026-09-18" } });
    fireEvent.change(screen.getByLabelText(/Receipt \/ OR number/), { target: { value: "OR-1" } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Diesel, Digos" } });
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit claim" }));
    // typed in: the photo is attached, not read
    expect(state.scan).not.toHaveBeenCalled();

    await waitFor(() => expect(state.submit).toHaveBeenCalledTimes(1));
    const [runId, form] = state.submit.mock.calls[0];
    expect(runId).toBe("11");
    expect(form.get("category")).toBe("fuel");
    expect(form.get("amount")).toBe("1850.5");
    expect(form.get("expenseDate")).toBe("2026-09-18");
    expect(form.get("receiptNo")).toBe("OR-1");
    expect(form.get("description")).toBe("Diesel, Digos");
    expect(form.get("receipt").name).toBe("receipt.jpg");

    expect(await screen.findByText("Claim submitted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to claims" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("sends the same reference when Submit is pressed again, so the server files it once", async () => {
    // weak signal: the first send got no answer, the driver presses Submit again
    state.submit
      .mockRejectedValueOnce(new Error("Trackify took too long to answer."))
      .mockResolvedValueOnce({ data: { id: 9 } });
    render(<DriverClaimForm onBack={() => {}} onDone={() => {}} />);
    await screen.findByRole("button", { name: "Fuel" });
    fireEvent.click(screen.getByRole("button", { name: "Fuel" }));
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit claim" }));
    await screen.findByText("Trackify took too long to answer.");
    fireEvent.click(screen.getByRole("button", { name: "Submit claim" }));
    expect(await screen.findByText("Claim submitted")).toBeInTheDocument();

    const [first, second] = state.submit.mock.calls.map(([, form]) => form.get("clientRef"));
    expect(first).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(second).toBe(first);
  });

  it("gives a new claim its own reference, so two real claims are never merged", async () => {
    const { unmount } = render(<DriverClaimForm onBack={() => {}} onDone={() => {}} />);
    await screen.findByRole("button", { name: "Fuel" });
    fireEvent.click(screen.getByRole("button", { name: "Fuel" }));
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit claim" }));
    await screen.findByText("Claim submitted");
    unmount();

    render(<DriverClaimForm onBack={() => {}} onDone={() => {}} />);
    await screen.findByRole("button", { name: "Fuel" });
    fireEvent.click(screen.getByRole("button", { name: "Fuel" }));
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit claim" }));
    await screen.findByText("Claim submitted");

    const [first, second] = state.submit.mock.calls.map(([, form]) => form.get("clientRef"));
    expect(second).not.toBe(first);
  });

  it("offline, will not submit a claim, keeps what was entered, and submits it once back online", async () => {
    render(<DriverClaimForm onBack={() => {}} onDone={() => {}} />);
    await screen.findByRole("button", { name: "Toll" });
    fireEvent.click(screen.getByRole("button", { name: "Toll" }));
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "350" } });

    setNet("offline");
    expect(screen.getByRole("button", { name: "Submit claim" })).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent("Submitting a claim needs the internet");
    expect(screen.getByLabelText(/Amount/)).toHaveDisplayValue("350");
    expect(state.submit).not.toHaveBeenCalled();

    setNet("online");
    fireEvent.click(screen.getByRole("button", { name: "Submit claim" }));
    expect(await screen.findByText("Claim submitted")).toBeInTheDocument();
  });

  it("keeps the form open with the server's reason when it refuses the claim", async () => {
    state.submit.mockRejectedValue(Object.assign(new Error("This trip closed too long ago to add expenses."), { status: 409 }));
    render(<DriverClaimForm onBack={() => {}} onDone={() => {}} />);
    await screen.findByRole("button", { name: "Fuel" });
    fireEvent.click(screen.getByRole("button", { name: "Fuel" }));
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit claim" }));
    expect(await screen.findByText("This trip closed too long ago to add expenses.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit claim" })).toBeEnabled();
  });

  it("shows each run with its route and status, and marks the one chosen", async () => {
    state.trips = [
      { id: 2, ticketNo: "TT-0002", status: "released", origin: "Makati, Metro Manila", destination: "Cavite, Calabarzon" },
      { id: 3, ticketNo: "TT-0003", status: "in_transit", origin: "Davao City", destination: "Digos City" },
    ];
    render(<DriverClaimForm onBack={() => {}} onDone={() => {}} />);
    const first = await screen.findByRole("radio", { name: /TT-0002/ });
    expect(first).toHaveTextContent("Makati");
    expect(first).toHaveTextContent("Cavite");
    expect(first).toHaveTextContent("Ready to start");
    expect(screen.getByRole("radio", { name: /TT-0003/ })).toHaveTextContent("On the road");
    expect(first).toHaveAttribute("aria-checked", "false");

    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: /TT-0003/ }));
    expect(first).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: /TT-0003/ })).toHaveAttribute("aria-checked", "true");
  });

  it("from a trip, shows the run instead of asking for it", () => {
    render(<DriverClaimForm fixedTrip={{ id: 5, ticketNo: "TT-0005" }} onBack={() => {}} onDone={() => {}} />);
    const run = screen.getByRole("radio", { name: /TT-0005/ });
    expect(run).toHaveAttribute("aria-checked", "true");
    expect(run).toBeDisabled(); // already known: nothing to choose
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("scanning a receipt into the claim form", () => {
  const PETRON = {
    status: "read",
    fields: {
      amount: 2200, category: "fuel", merchant: "Petron", description: "Petron — Turbo Diesel 35.200 L",
      expenseDate: "2026-09-18", receiptNo: "0045821",
    },
    confidence: { amount: "high", category: "high", merchant: "medium", description: "medium", expenseDate: "high", receiptNo: "medium" },
  };

  beforeEach(() => {
    state.trips = [{ id: 11, ticketNo: "TT-0011", status: "in_transit", destination: "Digos, Davao del Sur" }];
    state.submit.mockReset().mockResolvedValue({ data: { id: 9 } });
    state.scan.mockReset();
  });

  const openForm = async () => {
    render(<DriverClaimForm onBack={() => {}} onDone={() => {}} />);
    await screen.findByRole("button", { name: "Fuel" });
  };

  it("is the way the form opens, and both ways stay on offer", async () => {
    await openForm();
    expect(screen.getByRole("radio", { name: "Scan receipt" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Type it in" })).toHaveAttribute("aria-checked", "false");
  });

  it("fills in the type, amount, description, date and OR number, marks them, and sends them with the photo", async () => {
    state.scan.mockResolvedValue(PETRON);
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));

    expect(await screen.findByText(/Filled in from the receipt/)).toBeInTheDocument();
    expect(state.scan).toHaveBeenCalledTimes(1);
    expect(state.scan.mock.calls[0][0].name).toBe("receipt.jpg");
    expect(screen.getByRole("button", { name: "Fuel" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(/Amount/)).toHaveValue(2200);
    expect(screen.getByLabelText(/Date/)).toHaveValue("2026-09-18");
    expect(screen.getByLabelText(/Receipt \/ OR number/)).toHaveValue("0045821");
    expect(screen.getByLabelText(/Description/)).toHaveValue("Petron — Turbo Diesel 35.200 L");
    expect(screen.getAllByText("From receipt").length).toBe(5);

    fireEvent.click(screen.getByRole("button", { name: "Submit claim" }));
    await waitFor(() => expect(state.submit).toHaveBeenCalledTimes(1));
    const [, form] = state.submit.mock.calls[0];
    expect(form.get("category")).toBe("fuel");
    expect(form.get("amount")).toBe("2200");
    expect(form.get("expenseDate")).toBe("2026-09-18");
    expect(form.get("receiptNo")).toBe("0045821");
    expect(form.get("description")).toBe("Petron — Turbo Diesel 35.200 L");
    expect(form.get("receipt").name).toBe("receipt.jpg");
  });

  it("keeps every value editable, and a corrected value is the driver's own", async () => {
    state.scan.mockResolvedValue(PETRON);
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
    await screen.findByText(/Filled in from the receipt/);

    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "2150" } });
    fireEvent.click(screen.getByRole("button", { name: "Toll" }));
    expect(screen.getAllByText("From receipt").length).toBe(3);

    fireEvent.click(screen.getByRole("button", { name: "Submit claim" }));
    await waitFor(() => expect(state.submit).toHaveBeenCalledTimes(1));
    const [, form] = state.submit.mock.calls[0];
    expect(form.get("amount")).toBe("2150");
    expect(form.get("category")).toBe("toll");
  });

  it("flags a value that was hard to read", async () => {
    state.scan.mockResolvedValue({ ...PETRON, confidence: { ...PETRON.confidence, amount: "low" } });
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
    expect(await screen.findByText("Check this")).toBeInTheDocument();
    expect(screen.getByText(/hard to read/)).toBeInTheDocument();
  });

  it("a receipt it cannot read leaves the form to type in, with the photo still attached", async () => {
    state.scan.mockResolvedValue({ status: "not_a_receipt", message: "Could not read a receipt in that photo." });
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
    expect(await screen.findByText("Could not read a receipt in that photo.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Amount/)).toHaveValue(null);

    fireEvent.click(screen.getByRole("button", { name: "Meals" }));
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "180" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit claim" }));
    await waitFor(() => expect(state.submit).toHaveBeenCalledTimes(1));
    expect(state.submit.mock.calls[0][1].get("receipt").name).toBe("receipt.jpg");
  });

  it("out of signal it says so instead of reading, and the claim can still be filed", async () => {
    state.scan.mockRejectedValue(Object.assign(new Error("No signal, so the receipt cannot be read right now."), { offline: true }));
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
    expect(await screen.findByText(/No signal/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit claim" })).toBeEnabled();
  });

  it("a retake replaces what the first reading filled in, and drops what the new one did not find", async () => {
    state.scan
      .mockResolvedValueOnce(PETRON)
      .mockResolvedValueOnce({ status: "read", fields: { amount: 327, category: "toll" }, confidence: { amount: "high", category: "high" } });
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
    await screen.findByText(/Filled in from the receipt/);
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));

    await waitFor(() => expect(screen.getByLabelText(/Amount/)).toHaveValue(327));
    expect(screen.getByRole("button", { name: "Toll" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(/Receipt \/ OR number/)).toHaveValue("");
    expect(screen.getByLabelText(/Description/)).toHaveValue("");
  });

  it("does not let a claim go while the receipt is still being read", async () => {
    let answer;
    state.scan.mockReturnValue(new Promise((r) => { answer = r; }));
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
    expect(await screen.findByRole("button", { name: "Reading receipt…" })).toBeDisabled();
    answer(PETRON);
    expect(await screen.findByRole("button", { name: "Submit claim" })).toBeEnabled();
  });

  it("switching to Type it in keeps what was read", async () => {
    state.scan.mockResolvedValue(PETRON);
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
    await screen.findByText(/Filled in from the receipt/);
    fireEvent.click(screen.getByRole("radio", { name: "Type it in" }));
    expect(screen.getByLabelText(/Amount/)).toHaveValue(2200);
    expect(screen.getByText("receipt.jpg")).toBeInTheDocument();
  });
});
