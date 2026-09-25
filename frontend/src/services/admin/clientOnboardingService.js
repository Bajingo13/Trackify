import { post } from "../apiClient";

export async function createClientSetup(payload) {
  const response = await post("/admin/client-onboarding", payload);
  return response.data;
}
