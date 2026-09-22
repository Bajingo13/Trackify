import { patch, post, del, getDataUrl, postForm } from "../apiClient";

/**
 * Your own account. Not company-scoped — these belong to the person.
 */

export async function updateMyProfile(payload) {
  const res = await patch("/account", payload);
  return res;
}

export async function changeMyPassword(currentPassword, newPassword) {
  const res = await post("/account/password", { currentPassword, newPassword });
  return res;
}

/**
 * The photo sits behind an authenticated route, so it cannot go straight into
 * an `<img src>` — it is fetched with the token and handed over as a data URL,
 * the same way receipts are.
 */
export async function getMyPhoto() {
  try {
    return await getDataUrl("/account/photo");
  } catch (error) {
    if (error.status === 404) return null; // no photo yet is not a failure
    throw error;
  }
}

export async function uploadMyPhoto(file) {
  const form = new FormData();
  form.append("photo", file);
  return postForm("/account/photo", form);
}

export async function removeMyPhoto() {
  return del("/account/photo");
}
