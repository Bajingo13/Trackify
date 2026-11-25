import axe from "axe-core";

const JSDOM_OPTIONS = {
  rules: {
    // JSDOM has no layout or canvas rendering, so computed contrast results are
    // not trustworthy here. Keep contrast in browser/manual QA and let this
    // suite enforce the DOM rules Axe can evaluate accurately.
    "color-contrast": { enabled: false },
  },
};

function formatViolation(violation) {
  const targets = violation.nodes
    .flatMap((node) => node.target)
    .map((target) => `  - ${target}`)
    .join("\n");

  return `${violation.id}: ${violation.help}\n${targets}`;
}

export async function expectNoAxeViolations(container) {
  const results = await axe.run(container, JSDOM_OPTIONS);

  if (results.violations.length > 0) {
    throw new Error(
      `Axe found ${results.violations.length} accessibility violation(s):\n\n${results.violations
        .map(formatViolation)
        .join("\n\n")}`,
    );
  }
}
