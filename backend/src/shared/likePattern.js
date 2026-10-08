/**
 * A search term, made safe to put inside a LIKE pattern.
 *
 * `%` and `_` are wildcards in LIKE, so a person typing "%" or "_" into a
 * search box matched every row, and "TT_0042" matched "TTX0042". The values are
 * parameterised, so this was never an injection hole — only a search that
 * answered a different question from the one asked. Escaped with a backslash,
 * which is MySQL's default escape character.
 *
 * Capped, too: nobody is searching for a hundred-character ticket number, and
 * an unbounded pattern is an unbounded scan.
 */
export const MAX_SEARCH_LENGTH = 100;

const escaped = (term) =>
  String(term ?? "").trim().slice(0, MAX_SEARCH_LENGTH).replace(/[\\%_]/g, "\\$&");

export function containsPattern(term) {
  return `%${escaped(term)}%`;
}

/**
 * "Starts with" — the only LIKE shape MySQL can answer from an index. A
 * leading wildcard cannot use one and reads every row it is allowed to see.
 */
export function startsWithPattern(term) {
  return `${escaped(term)}%`;
}
