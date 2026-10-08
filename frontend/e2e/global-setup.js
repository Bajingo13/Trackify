import { checkTarget } from "./helpers/target.js";
import { API_URL, WEB_URL } from "./helpers/staffSession.js";

/**
 * Runs once before any spec. Refuses to start unless the URLs under test are
 * Trackify's own — see helpers/target.js for why this exists.
 */
export default async function globalSetup() {
  const problems = await checkTarget({ webUrl: WEB_URL, apiUrl: API_URL, env: process.env });
  if (problems.length) {
    throw new Error(
      [
        "The browser suite will not run: it is not pointed at Trackify.",
        ...problems.map((p) => `  • ${p}`),
        "No test was started and no credentials were sent.",
      ].join("\n"),
    );
  }
}
