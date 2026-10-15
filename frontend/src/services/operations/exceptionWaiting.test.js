import { describe, expect, it } from "vitest";
import { waitingFor } from "./exceptionService";

const NOW = new Date("2026-10-14T12:00:00Z").getTime();
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const ex = (extra = {}) => ({ status: "open", severity: "warning", awaitingSince: ago(5), ...extra });

describe("how long a driver has been waiting for the office", () => {
  it("says nothing when nobody is waiting", () => {
    expect(waitingFor(ex({ awaitingSince: null }), NOW)).toBeNull();
    expect(waitingFor(ex({ status: "resolved" }), NOW)).toBeNull();
    expect(waitingFor(null, NOW)).toBeNull();
    expect(waitingFor(ex({ awaitingSince: "not a date" }), NOW)).toBeNull();
  });

  it("reads the wait in minutes, then hours", () => {
    expect(waitingFor(ex({ awaitingSince: ago(0) }), NOW).text).toBe("under a minute");
    expect(waitingFor(ex({ awaitingSince: ago(5) }), NOW).text).toBe("5 min");
    expect(waitingFor(ex({ awaitingSince: ago(60) }), NOW).text).toBe("1 h");
    expect(waitingFor(ex({ awaitingSince: ago(130) }), NOW).text).toBe("2 h 10 min");
  });

  it("is calm at first, then late, then overdue", () => {
    expect(waitingFor(ex({ awaitingSince: ago(30) }), NOW).tone).toBe("new");
    expect(waitingFor(ex({ awaitingSince: ago(61) }), NOW).tone).toBe("late");
    expect(waitingFor(ex({ awaitingSince: ago(241) }), NOW).tone).toBe("overdue");
  });

  it("is less patient with a critical report: late after 15 minutes, overdue after an hour", () => {
    const critical = (min) => waitingFor(ex({ severity: "critical", awaitingSince: ago(min) }), NOW).tone;
    expect(critical(10)).toBe("new");
    expect(critical(20)).toBe("late");
    expect(critical(61)).toBe("overdue");
  });

  it("does not go negative if the phone's clock and the server's disagree", () => {
    expect(waitingFor(ex({ awaitingSince: new Date(NOW + 5 * 60000).toISOString() }), NOW).minutes).toBe(0);
  });
});
