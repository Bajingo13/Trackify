import { beforeEach, describe, expect, it } from "vitest"
import {
  forgetNotDelivered, localNotDelivered, notDeliveredState, reasonLabel, reasonsFor, rememberNotDelivered, REPORT_REASONS,
} from "./deliveryReport"

describe("the reasons", () => {
  it("match the server's: three for a problem delivery, four for not delivered, photos for short and damaged", () => {
    expect(reasonsFor("delivered_with_issue").map((r) => r.value)).toEqual(["short", "damaged", "wrong_item"])
    expect(reasonsFor("not_delivered").map((r) => r.value)).toEqual(["refused", "absent", "wrong_address", "other"])
    expect(REPORT_REASONS.filter((r) => r.photo).map((r) => r.value)).toEqual(["short", "damaged"])
    expect(reasonLabel("absent")).toBe("Receiver absent or closed")
    expect(reasonLabel("nonsense")).toBe("Other reason")
  })
})

describe("where a not-delivered report stands", () => {
  beforeEach(() => localStorage.clear())
  const onRoad = (deliveryReport) => ({ status: "in_transit", deliveryReport })
  const server = (extra) => ({ outcome: "not_delivered", reason: "absent", status: "open", submittedAt: "2026-10-27T03:00:00Z", ...extra })

  it("nothing reported: nothing to say", () => {
    expect(notDeliveredState(onRoad(null), null)).toBeNull()
  })

  it("only while the trip is on the road", () => {
    expect(notDeliveredState({ status: "returned", deliveryReport: server() }, null)).toBeNull()
    expect(notDeliveredState({ status: "delivered" }, { reason: "refused", at: Date.now() })).toBeNull()
  })

  it("the server's open report, and its request for another try", () => {
    expect(notDeliveredState(onRoad(server()), null)).toEqual({ state: "waiting", reason: "absent" })
    expect(notDeliveredState(onRoad(server({ status: "reattempt" })), null)).toEqual({ state: "reattempt", reason: "absent" })
    expect(notDeliveredState(onRoad(server({ status: "resolved" })), null)).toBeNull()
  })

  it("this phone's report counts until the server has it", () => {
    const local = { reason: "refused", at: Date.parse("2026-10-27T05:00:00Z") }
    expect(notDeliveredState(onRoad(null), local)).toEqual({ state: "waiting", reason: "refused" })
    // the server has an older report, settled: this phone's newer one is the one waiting
    expect(notDeliveredState(onRoad(server({ status: "resolved" })), local)).toEqual({ state: "waiting", reason: "refused" })
    // the server has caught up with it
    expect(notDeliveredState(onRoad(server({ status: "reattempt", submittedAt: "2026-10-27T05:00:10Z" })), local))
      .toEqual({ state: "reattempt", reason: "absent" })
  })

  it("a problem with a delivery that went through is not a not-delivered", () => {
    expect(notDeliveredState(onRoad({ outcome: "delivered_with_issue", reason: "short", status: "open" }), null)).toBeNull()
  })

  it("is remembered per driver and trip, and forgotten", () => {
    rememberNotDelivered(7, 41, { reason: "refused" })
    expect(localNotDelivered(7, 41)).toMatchObject({ reason: "refused" })
    expect(localNotDelivered(8, 41)).toBeNull()
    forgetNotDelivered(7, 41)
    expect(localNotDelivered(7, 41)).toBeNull()
  })
})
