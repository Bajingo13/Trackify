import { describe, expect, it } from "vitest";
import { runStatus } from "./supportKinds";

/*
 * A pause never changes the trip's status: it stays in_transit underneath. What
 * the driver reads on Today and on the run screen has to say the truck is held.
 */
describe("the run's status chip", () => {
  it("reads Paused while a pause the office approved is in force", () => {
    expect(runStatus("in_transit", "approved")).toEqual({ label: "Paused", key: "paused" });
  });

  it("reads Pause requested while the office has yet to answer", () => {
    expect(runStatus("in_transit", "pending")).toEqual({ label: "Pause requested", key: "pause_pending" });
  });

  it("reads In transit again once the delivery is resumed (no open pause)", () => {
    expect(runStatus("in_transit", null)).toEqual({ label: "in transit", key: "in_transit" });
  });

  it("is unaffected by a pause on any other status", () => {
    expect(runStatus("released", "approved").key).toBe("released");
    expect(runStatus("delivered", "pending").label).toBe("delivered");
  });
});
