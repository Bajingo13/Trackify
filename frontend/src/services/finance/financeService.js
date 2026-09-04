import { get, post, patch, del } from "../apiClient";

const qs = (params = {}) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "" && v !== "all") q.set(k, v);
  });
  const s = q.toString();
  return s ? `?${s}` : "";
};

// `list` returns just the array (reports / pickers want everything).
// `listPage` returns { data, pagination } — pass page & limit for a table.
const listers = (path) => ({
  list: async (f) => (await get(`/finance/${path}${qs(f)}`)).data || [],
  listPage: async (f) => {
    const res = await get(`/finance/${path}${qs(f)}`);
    return { data: res.data || [], pagination: res.pagination || null };
  },
});

/* ---------------- Trip expenses ---------------- */
export const expenseApi = {
  ...listers("expenses"),
  stats: async () => (await get("/finance/expenses/stats")).data || {},
  create: (d) => post("/finance/expenses", d),
  update: (id, d) => patch(`/finance/expenses/${id}`, d),
  remove: (id) => del(`/finance/expenses/${id}`),
};

/* ---------------- Expense vouchers ---------------- */
export const voucherApi = {
  ...listers("vouchers"),
  stats: async () => (await get("/finance/vouchers/stats")).data || {},
  get: async (id) => (await get(`/finance/vouchers/${id}`)).data,
  create: (d) => post("/finance/vouchers", d),
  update: (id, d) => patch(`/finance/vouchers/${id}`, d),
  submit: (id) => post(`/finance/vouchers/${id}/submit`),
  approve: (id) => post(`/finance/vouchers/${id}/approve`),
  reject: (id) => post(`/finance/vouchers/${id}/reject`),
  pay: (id) => post(`/finance/vouchers/${id}/pay`),
  remove: (id) => del(`/finance/vouchers/${id}`),
};

/* ---------------- Invoices ---------------- */
export const invoiceApi = {
  ...listers("invoices"),
  stats: async () => (await get("/finance/invoices/stats")).data || {},
  get: async (id) => (await get(`/finance/invoices/${id}`)).data,
  create: (d) => post("/finance/invoices", d),
  update: (id, d) => patch(`/finance/invoices/${id}`, d),
  send: (id) => post(`/finance/invoices/${id}/send`),
  payment: (id, amount) => post(`/finance/invoices/${id}/payment`, { amount }),
  void: (id) => post(`/finance/invoices/${id}/void`),
};

/* ---------------- Journal entries ---------------- */
export const journalApi = {
  ...listers("journal"),
  stats: async () => (await get("/finance/journal/stats")).data || {},
  get: async (id) => (await get(`/finance/journal/${id}`)).data,
  create: (d) => post("/finance/journal", d),
  update: (id, d) => patch(`/finance/journal/${id}`, d),
  post: (id) => post(`/finance/journal/${id}/post`),
  void: (id) => post(`/finance/journal/${id}/void`),
  remove: (id) => del(`/finance/journal/${id}`),
};

/* ---------------- BIR / EIS register ---------------- */
export const birApi = {
  ...listers("bir"),
  stats: async () => (await get("/finance/bir/stats")).data || {},
  create: (d) => post("/finance/bir", d),
  update: (id, d) => patch(`/finance/bir/${id}`, d),
  remove: (id) => del(`/finance/bir/${id}`),
};

export const peso = (n) =>
  `₱${Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
