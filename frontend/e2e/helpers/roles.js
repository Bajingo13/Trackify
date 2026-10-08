/**
 * Run the signed-in session as a role with only the given permissions.
 *
 * What the console shows is decided from the permissions the server reports
 * (/api/auth/me) plus the copy stored at sign-in, so to see the console as
 * another role both are replaced; the API itself is not touched, which is why
 * server-side refusals are tested separately against the real endpoints.
 * `roles: []` stops the stored session from being read as an administrator.
 *
 * Call after installStaffSession(context).
 */
export async function restrictTo(context, page, permissions) {
  await context.addInitScript((perms) => {
    try {
      const stored = JSON.parse(localStorage.getItem("ttms_auth") || "null");
      if (stored) localStorage.setItem("ttms_auth", JSON.stringify({ ...stored, permissions: perms, roles: [] }));
    } catch { /* leave the session as it is */ }
  }, permissions);
  await page.route("**/api/auth/me", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body?.data) body.data.permissions = permissions;
    await route.fulfill({ response, json: body });
  });
}
