import { describe, it, expect } from "vitest";
import { buildCsv } from "./exportCsv";

const cols = [
  { header: "Trip", value: (r) => r.a },
  { header: "Note", value: (r) => r.b },
];

describe("buildCsv", () => {
  it("writes a BOM, a header and CRLF rows", () => {
    expect(buildCsv(cols, [{ a: "T-1", b: "ok" }])).toBe("\uFEFFTrip,Note\r\nT-1,ok\r\n");
  });
  it("quotes commas, quotes and line breaks", () => {
    const out = buildCsv(cols, [{ a: "A, B", b: 'say "hi"\nnow' }]);
    expect(out).toContain('"A, B","say ""hi""\nnow"');
  });
  it("neutralises formulas typed into a record", () => {
    const out = buildCsv(cols, [{ a: "=HYPERLINK(\"x\")", b: "+1" }]);
    expect(out).toContain(`"'=HYPERLINK(""x"")"`);
    expect(out).toContain(",'+1");
  });
  it("leaves numbers alone and turns missing values into empty cells", () => {
    expect(buildCsv(cols, [{ a: -5, b: null }])).toContain("\r\n-5,\r\n");
  });
  it("exports just the header for no rows", () => {
    expect(buildCsv(cols, [])).toBe("\uFEFFTrip,Note\r\n");
  });
});
