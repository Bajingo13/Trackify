import { safeCellValue, triggerDownload } from "./exportExcel";

/**
 * Comma-separated export of whatever a list is showing.
 *
 * Every text value goes through safeCellValue first, for the same reason the
 * Excel export does: a customer or place somebody typed as `=HYPERLINK(...)`
 * must not become a live formula when the file is opened in a spreadsheet.
 * Then RFC 4180 quoting, so commas, quotes and line breaks in a value stay in
 * their own cell. Rows end in CRLF, and a UTF-8 byte-order mark leads the file
 * so Excel reads names such as "Peña" correctly instead of as Latin-1.
 *
 * columns = [{ header: "Trip", value: (row) => row.ticketNo }, ...]
 */
export function buildCsv(columns, rows) {
  const cell = (raw) => {
    const value = safeCellValue(raw ?? "");
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map((c) => cell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function downloadCsv(filename, columns, rows) {
  const name = filename.toLowerCase().endsWith(".csv") ? filename : `${filename}.csv`;
  triggerDownload(new Blob([buildCsv(columns, rows)], { type: "text/csv;charset=utf-8" }), name);
}
