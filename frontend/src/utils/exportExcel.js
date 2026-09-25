/**
 * Build a locked .xlsx workbook and start a download.
 *
 * Every sheet is protected with a fresh random password that is never shown, and
 * every cell is locked, so the file opens fine for reading but cannot be edited,
 * re-sorted, or have rows/columns inserted in Excel / Google Sheets / LibreOffice.
 * (Sheet protection in the OOXML format is not cryptographically strong — a
 * determined user could unzip the file and strip it — but it stops all normal
 * editing.)
 *
 * spec = {
 *   filename: "Expense Report 2026-09-02",
 *   title:    "AstreaBlue Trackify — Expense Report",
 *   meta:     [["Generated", "..."], ["Date range", "..."]],   // optional
 *   sheets:   [{ name, rows: [[headerCells...], [dataRow...], ...] }]
 * }
 */
export async function exportLockedWorkbook(spec) {
  // loaded on demand — keeps ExcelJS (~large) out of the main bundle
  const ExcelJS = (await import("exceljs")).default;
  const wb = await buildLockedWorkbook(ExcelJS, spec);
  const buf = await wb.xlsx.writeBuffer();
  triggerDownload(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    spec.filename.toLowerCase().endsWith(".xlsx") ? spec.filename : `${spec.filename}.xlsx`
  );
}

/*
 * A spreadsheet treats a leading =, +, - or @ as the start of a formula, so a
 * customer named `=cmd|'/c calc'!A1` becomes executable the moment somebody
 * opens the export and clicks through Excel's warning. Every value in these
 * workbooks comes from a record somebody typed — customer names, driver names,
 * trip origins — so each is neutralised by prefixing a single quote, which
 * Excel shows as text and does not include in the cell's value.
 *
 * Numbers, dates and booleans are passed through untouched: they are not text
 * and cannot carry a formula, and quoting them would turn a column of figures
 * into a column of strings that no longer sums.
 */
/* Written as a list rather than a character class: the two control characters
 * are invisible in a regex literal, and `+-@` inside brackets is a range, not
 * three characters — a mistake that would have quoted every number. */
const FORMULA_LEADS = ["=", "+", "-", "@", String.fromCharCode(9), String.fromCharCode(13)];

export function safeCellValue(value) {
  if (typeof value !== "string" || value === "") return value;
  return FORMULA_LEADS.includes(value[0]) ? `'${value}` : value;
}

/** Pure builder — takes an ExcelJS module, returns a protected Workbook. */
export async function buildLockedWorkbook(ExcelJS, spec) {
  const { title, meta = [], sheets } = spec;

  const wb = new ExcelJS.Workbook();
  wb.creator = "AstreaBlue Trackify";
  wb.created = new Date();

  const pw = randomPassword();
  const protectOpts = {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false, formatColumns: false, formatRows: false,
    insertColumns: false, insertRows: false, insertHyperlinks: false,
    deleteColumns: false, deleteRows: false,
    sort: false, autoFilter: false, pivotTables: false,
  };

  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31), {
      properties: { defaultColWidth: 20 },
    });

    let r = 1;
    if (title) {
      ws.getCell(`A${r}`).value = safeCellValue(title);
      ws.getCell(`A${r}`).font = { bold: true, size: 14 };
      r += 1;
      ws.getCell(`A${r}`).value = safeCellValue(s.name);
      ws.getCell(`A${r}`).font = { bold: true, size: 11, color: { argb: "FF667085" } };
      r += 2;
    }
    for (const [k, v] of meta) {
      ws.getCell(`A${r}`).value = safeCellValue(k);
      ws.getCell(`A${r}`).font = { color: { argb: "FF667085" } };
      ws.getCell(`B${r}`).value = safeCellValue(v);
      r += 1;
    }
    if (meta.length) r += 1;

    const headerRowIndex = r;
    (s.rows || []).forEach((cells, i) => {
      const row = ws.getRow(r);
      cells.forEach((val, c) => {
        row.getCell(c + 1).value = safeCellValue(val);
      });
      if (i === 0) {
        row.font = { bold: true };
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2F6" } };
          cell.border = { bottom: { style: "thin", color: { argb: "FFCBD5E1" } } };
        });
      }
      r += 1;
    });

    // auto-ish column widths from content
    const colCount = Math.max(0, ...(s.rows || []).map((x) => x.length));
    for (let c = 1; c <= colCount; c += 1) {
      let max = 10;
      (s.rows || []).forEach((cells) => {
        const len = String(cells[c - 1] ?? "").length;
        if (len > max) max = len;
      });
      ws.getColumn(c).width = Math.min(Math.max(max + 2, 12), 60);
    }

    if (s.rows && s.rows.length > 1) {
      ws.views = [{ state: "frozen", ySplit: headerRowIndex }];
    }

    // lock every cell, then protect the sheet
    ws.eachRow((row) => row.eachCell((cell) => { cell.protection = { locked: true }; }));
    await ws.protect(pw, protectOpts);
  }

  return wb;
}

function randomPassword() {
  const a = new Uint8Array(24);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
