import { beforeEach, describe, expect, it } from "vitest";
import {
  canStartWith, forgetInspection, inspectionGate, localInspection, rememberInspection, resultOfAnswers,
} from "./inspectionLocal";

const CHECKLIST = [
  { key: "brakes", critical: true }, { key: "tyres", critical: true }, { key: "lights", critical: true }, { key: "fluids", critical: false },
];
const released = (inspection) => ({ status: "released", inspection });
const required = (extra = {}) => ({ required: true, checklist: CHECKLIST, blocked: false, satisfied: false, approved: false, result: null, ...extra });

describe("the result the phone works out", () => {
  it("fails critically on brakes, tyres or lights, flags anything else, and passes otherwise", () => {
    expect(resultOfAnswers({ brakes: { response: "ok" }, fluids: { response: "na" } }, CHECKLIST)).toBe("pass");
    expect(resultOfAnswers({ fluids: { response: "problem" } }, CHECKLIST)).toBe("fail_noncritical");
    for (const key of ["brakes", "tyres", "lights"]) {
      expect(resultOfAnswers({ [key]: { response: "problem" }, fluids: { response: "problem" } }, CHECKLIST)).toBe("fail_critical");
    }
  });
});

describe("whether Start is allowed", () => {
  it("is untouched when the company does not require an inspection, or the trip is past release", () => {
    expect(inspectionGate({ status: "released" }, null)).toBeNull();
    expect(inspectionGate(released({ required: false }), { result: "fail_critical" })).toBeNull();
    expect(inspectionGate({ status: "in_transit", inspection: required() }, null)).toBeNull();
    expect(canStartWith(null)).toBe(true);
  });

  it("asks for the inspection until there is one", () => {
    expect(inspectionGate(released(required()), null)).toBe("needed");
    expect(canStartWith("needed")).toBe(false);
  });

  it("holds on a critical failure, from the server or from this phone, until Fleet approves", () => {
    expect(inspectionGate(released(required({ blocked: true })), null)).toBe("blocked");
    expect(inspectionGate(released(required()), { result: "fail_critical" })).toBe("blocked");
    expect(canStartWith("blocked")).toBe(false);
    // the server's word wins over what the phone remembers
    expect(inspectionGate(released(required({ satisfied: true, approved: true, result: "fail_critical" })), { result: "fail_critical" })).toBe("approved");
    expect(canStartWith("approved")).toBe(true);
  });

  it("lets a pass or a flagged issue start", () => {
    expect(inspectionGate(released(required({ satisfied: true, result: "pass" })), null)).toBe("passed");
    expect(inspectionGate(released(required({ satisfied: true, result: "fail_noncritical" })), null)).toBe("flagged");
    expect(inspectionGate(released(required()), { result: "pass" })).toBe("passed");
    expect(inspectionGate(released(required()), { result: "fail_noncritical" })).toBe("flagged");
    expect(canStartWith("passed")).toBe(true);
    expect(canStartWith("flagged")).toBe(true);
  });
});

describe("what this phone filed", () => {
  beforeEach(() => localStorage.clear());

  it("is kept per driver and trip, and forgotten on request", () => {
    rememberInspection(7, 41, { result: "fail_critical", clientRef: "insp-0000000001" });
    expect(localInspection(7, 41)).toMatchObject({ result: "fail_critical" });
    expect(localInspection(8, 41)).toBeNull();
    expect(localInspection(7, 42)).toBeNull();
    forgetInspection(7, 41);
    expect(localInspection(7, 41)).toBeNull();
  });

  it("reads junk as nothing", () => {
    localStorage.setItem("trackify-driver-inspection:7:41", "{nope");
    expect(localInspection(7, 41)).toBeNull();
  });
});
