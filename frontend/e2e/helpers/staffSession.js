export const API_URL = (process.env.TRACKIFY_API_URL || "http://localhost:5001").replace(/\/$/, "");
export const WEB_URL = (process.env.TRACKIFY_WEB_URL || "http://localhost:8444").replace(/\/$/, "");
export const STAFF_EMAIL = process.env.TRACKIFY_TEST_EMAIL || "superadmin@gmail.com";
export const STAFF_PASSWORD = process.env.TRACKIFY_TEST_PASSWORD || "demo123";
export const FIRST_PARTY_ORIGINS = new Set([new URL(WEB_URL).origin, new URL(API_URL).origin]);

let seededSessionPromise;

export async function loadSeededStaffSession() {
  if (!seededSessionPromise) {
    seededSessionPromise = (async () => {
      let response;
      try {
        response = await fetch(`${API_URL}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: STAFF_EMAIL, password: STAFF_PASSWORD }),
        });
      } catch {
        throw new Error(
          `Trackify API is unavailable at ${API_URL}. Start the local backend or set TRACKIFY_API_URL.`,
        );
      }

      if (!response.ok) {
        throw new Error(
          `Staff test login returned HTTP ${response.status}. Set TRACKIFY_TEST_EMAIL and TRACKIFY_TEST_PASSWORD to a seeded staff account.`,
        );
      }

      const body = await response.json();
      const data = body?.data;
      if (!data?.token || !data?.user) {
        throw new Error("Staff test login succeeded without the expected user session payload.");
      }

      const user = {
        ...data.user,
        token: data.token,
        access: data.access || [],
        roles: data.roles || [],
        permissions: data.permissions || [],
      };
      const scope = user.access.find((item) => item.branch_id) || user.access[0] || {};

      // Every authenticated screen sits behind the Terms of Service gate, so a
      // seeded account that has not accepted would fail all 43 route checks on
      // a gate this suite is not testing. Accepting here keeps the crawl about
      // the screens; the gate has its own cover.
      try {
        await fetch(`${API_URL}/api/v1/agreement/accept`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${data.token}`,
          },
          body: "{}",
        });
      } catch {
        // Older builds have no agreement route. The route checks below will
        // report it plainly if the gate is present and unaccepted.
      }

      return {
        user,
        companyId: scope.company_id || null,
        branchId: scope.branch_id || null,
      };
    })();
  }
  return seededSessionPromise;
}

export async function installStaffSession(context) {
  const session = await loadSeededStaffSession();
  await context.addInitScript((state) => {
    localStorage.setItem("ttms_auth", JSON.stringify(state.user));
    if (state.companyId) localStorage.setItem("ttms_company_id", state.companyId);
    else localStorage.removeItem("ttms_company_id");
    if (state.branchId) localStorage.setItem("ttms_branch_id", state.branchId);
    else localStorage.removeItem("ttms_branch_id");
  }, session);
}

