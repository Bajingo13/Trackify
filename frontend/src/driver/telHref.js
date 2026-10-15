/**
 * A `tel:` link for a number as it was typed into the customer record, or null
 * when there is nothing dialable in it.
 *
 * Those numbers are free text — "0917 123 4567", "(02) 8123-4567", sometimes
 * two of them, or one with an extension. Only the first number is used: joining
 * the digits of two would dial a third that belongs to nobody. A leading + is
 * kept, since it is what makes an international number work from any country.
 */
export function telHref(raw) {
  const first = String(raw ?? "")
    .split(/\s*(?:\/|,|;|\bor\b|\bext\b|\bloc\b|\blocal\b)/i)[0]
    .trim();
  const digits = first.replace(/\D/g, "");
  // shorter than a local line, or longer than any number can be (E.164 caps at 15)
  if (digits.length < 5 || digits.length > 15) return null;
  return `tel:${first.startsWith("+") ? "+" : ""}${digits}`;
}
