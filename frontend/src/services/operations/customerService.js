import { get } from "../apiClient";

export async function searchCustomers(search = "") {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await get(`/customers${query}`);
  return res.data || [];
}

export async function getCustomer(id) {
  const res = await get(`/customers/${id}`);
  return res.data;
}
