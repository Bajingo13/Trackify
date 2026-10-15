import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expiryTone, fmtDate, licenceAttention, licenceState } from "./licenceExpiry";

vi.mock("./native", () => ({ tap: () => {} }));

const { default: LicenceNotice } = await import("./LicenceNotice");

describe("the licence notice on Home", () => {
  it("says nothing while the licence is fine, so it is news when it appears", () => {
    const { container } = render(<LicenceNotice licence={{ expiry: "2030-01-01", daysLeft: 900, state: "valid" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says nothing when no licence is recorded, or the profile has not loaded", () => {
    expect(render(<LicenceNotice licence={{ state: "none", daysLeft: null }} />).container).toBeEmptyDOMElement();
    expect(render(<LicenceNotice licence={undefined} />).container).toBeEmptyDOMElement();
  });

  it("warns that it is expiring, with the date and where to go", () => {
    const onOpen = vi.fn();
    render(<LicenceNotice licence={{ expiry: "2026-11-20", daysLeft: 30, state: "expiring" }} onOpen={onOpen} />);
    expect(screen.getByText("Your licence expires in 30 days")).toBeInTheDocument();
    // (the order of day and month is the device locale's business, not this test's)
    expect(screen.getByText(/Renew it before (?=.*Nov)(?=.*\b20\b)(?=.*2026)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("is plainer and more urgent once it has expired, and says what it costs the driver", () => {
    render(<LicenceNotice licence={{ expiry: "2026-10-01", daysLeft: -14, state: "expired" }} />);
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "danger");
    expect(screen.getByText("Your licence has expired")).toBeInTheDocument();
    expect(screen.getByText(/can't be assigned trips/)).toBeInTheDocument();
  });

  it("turns urgent in the last week", () => {
    const { rerender } = render(<LicenceNotice licence={{ expiry: "x", daysLeft: 20, state: "expiring" }} />);
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "warn");
    rerender(<LicenceNotice licence={{ expiry: "x", daysLeft: 7, state: "expiring" }} />);
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "danger");
  });

  it("today and tomorrow read naturally", () => {
    const { rerender } = render(<LicenceNotice licence={{ expiry: "2026-10-15", daysLeft: 0, state: "expiring" }} />);
    expect(screen.getByText("Your licence expires today")).toBeInTheDocument();
    rerender(<LicenceNotice licence={{ expiry: "2026-10-16", daysLeft: 1, state: "expiring" }} />);
    expect(screen.getByText("Your licence expires in 1 day")).toBeInTheDocument();
  });
});

describe("how an expiry is worded", () => {
  it("trusts the server's state, and only works one out when it is absent", () => {
    // the server counts in Manila; a phone's own clock is never consulted
    expect(licenceState({ state: "expired", daysLeft: 400 })).toBe("expired");
    expect(licenceState({ daysLeft: -1 })).toBe("expired");
    expect(licenceState({ daysLeft: 60 })).toBe("expiring");
    expect(licenceState({ daysLeft: 61 })).toBe("valid");
    expect(licenceState({ daysLeft: null })).toBe("none");
    expect(licenceState(null)).toBe("none");
  });

  it("the card flag", () => {
    expect(expiryTone(null)).toEqual({ tone: "none", say: "No expiry recorded" });
    expect(expiryTone(-1)).toEqual({ tone: "danger", say: "Expired 1 day ago" });
    expect(expiryTone(-5)).toEqual({ tone: "danger", say: "Expired 5 days ago" });
    expect(expiryTone(0)).toEqual({ tone: "danger", say: "Expires today" });
    expect(expiryTone(1)).toEqual({ tone: "warn", say: "Expires in 1 day" });
    expect(expiryTone(60)).toEqual({ tone: "warn", say: "Expires in 60 days" });
    expect(expiryTone(61)).toEqual({ tone: "ok", say: "Valid for 61 more days" });
  });

  it("no attention is needed for a valid or missing licence", () => {
    expect(licenceAttention({ state: "valid", daysLeft: 300 })).toBeNull();
    expect(licenceAttention({ state: "none" })).toBeNull();
  });

  it("a calendar date is not shifted by the timezone", () => {
    const isJan15 = (s) => /Jan/.test(s) && /\b15\b/.test(s) && /2027/.test(s);
    expect(isJan15(fmtDate("2027-01-15"))).toBe(true);
    expect(isJan15(fmtDate("2027-01-15T00:00:00.000Z"))).toBe(true);
    // the first of the month is the case a UTC-shifted date gets wrong
    expect(/\b1\b/.test(fmtDate("2027-03-01")) && /Mar/.test(fmtDate("2027-03-01"))).toBe(true);
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate("garbage")).toBe("—");
  });
});
