import ReferenceCrudPage from "./ReferenceCrudPage";
import {
  supplierService,
  accountService,
  warehouseMdService,
  taxCodeService,
  itemMdService,
} from "../../services/masterDataService";

const bold = (v) => <span style={{ fontWeight: 600, color: "var(--trackify-text)" }}>{v}</span>;
const dash = (v) => (v === null || v === undefined || v === "" ? "—" : v);

export function SuppliersPage() {
  return (
    <ReferenceCrudPage
      config={{
        title: "Suppliers",
        subtitle: "Vendors you purchase fuel, parts and services from",
        perm: "supplier",
        idKey: "supplier_id",
        service: supplierService,
        columns: [
          { label: "Code", render: (r) => r.supplier_code },
          { label: "Supplier", render: (r) => bold(r.supplier_name) },
          { label: "Contact", render: (r) => dash(r.contact_person) },
          { label: "Phone", render: (r) => dash(r.phone) },
          { label: "Email", render: (r) => dash(r.email) },
        ],
        fields: [
          { name: "supplierName", label: "Supplier Name *", required: true, get: (r) => r.supplier_name },
          { name: "contactPerson", label: "Contact Person", half: true, get: (r) => r.contact_person },
          { name: "phone", label: "Phone", half: true, get: (r) => r.phone },
          { name: "email", label: "Email", type: "email", half: true, get: (r) => r.email },
          { name: "taxId", label: "Tax ID / TIN", half: true, get: (r) => r.tax_id },
          { name: "address", label: "Address", type: "textarea", get: (r) => r.address },
        ],
      }}
    />
  );
}

export function ChartOfAccountsPage() {
  return (
    <ReferenceCrudPage
      config={{
        title: "Chart of Accounts",
        subtitle: "Ledger accounts used across finance and reporting",
        perm: "coa",
        idKey: "account_id",
        service: accountService,
        columns: [
          { label: "Code", render: (r) => r.account_code },
          { label: "Account", render: (r) => bold(r.account_name) },
          { label: "Type", render: (r) => <span style={{ textTransform: "capitalize" }}>{r.account_type}</span> },
          { label: "Description", render: (r) => dash(r.description) },
        ],
        fields: [
          { name: "code", label: "Account Code *", required: true, half: true, get: (r) => r.account_code },
          {
            name: "accountType",
            label: "Account Type *",
            half: true,
            get: (r) => r.account_type,
            options: [
              { value: "asset", label: "Asset" },
              { value: "liability", label: "Liability" },
              { value: "equity", label: "Equity" },
              { value: "income", label: "Income" },
              { value: "expense", label: "Expense" },
            ],
          },
          { name: "accountName", label: "Account Name *", required: true, get: (r) => r.account_name },
          { name: "description", label: "Description", type: "textarea", get: (r) => r.description },
        ],
      }}
    />
  );
}

export function TaxCodesPage() {
  return (
    <ReferenceCrudPage
      config={{
        title: "Tax Codes",
        subtitle: "VAT and withholding tax rates applied to transactions",
        perm: "taxcode",
        idKey: "tax_code_id",
        service: taxCodeService,
        columns: [
          { label: "Code", render: (r) => r.code },
          { label: "Name", render: (r) => bold(r.name) },
          { label: "Rate", render: (r) => `${Number(r.rate)}%` },
          { label: "Type", render: (r) => <span style={{ textTransform: "capitalize" }}>{r.tax_type}</span> },
        ],
        fields: [
          { name: "code", label: "Tax Code *", required: true, half: true, get: (r) => r.code },
          { name: "rate", label: "Rate (%) *", type: "number", required: true, half: true, get: (r) => Number(r.rate) },
          { name: "name", label: "Name *", required: true, get: (r) => r.name },
          {
            name: "taxType",
            label: "Tax Type *",
            get: (r) => r.tax_type,
            options: [
              { value: "vat", label: "VAT" },
              { value: "percentage", label: "Percentage Tax" },
              { value: "exempt", label: "Exempt" },
              { value: "withholding", label: "Withholding" },
            ],
          },
        ],
      }}
    />
  );
}

export function WarehousesPage() {
  return (
    <ReferenceCrudPage
      config={{
        title: "Warehouses",
        subtitle: "Storage locations that hold inventory stock",
        perm: "warehousemd",
        idKey: "warehouse_id",
        service: warehouseMdService,
        columns: [
          { label: "Code", render: (r) => r.code },
          { label: "Warehouse", render: (r) => bold(r.name) },
          { label: "Location", render: (r) => dash(r.location) },
        ],
        fields: [
          { name: "name", label: "Warehouse Name *", required: true, get: (r) => r.name },
          { name: "location", label: "Location", get: (r) => r.location },
        ],
      }}
    />
  );
}

export function ItemsPage() {
  return (
    <ReferenceCrudPage
      config={{
        title: "Items",
        subtitle: "Master catalog of parts, consumables and supplies",
        perm: "item",
        idKey: "id",
        service: itemMdService,
        columns: [
          { label: "SKU", render: (r) => r.itemId },
          { label: "Item", render: (r) => bold(r.name) },
          { label: "Category", render: (r) => dash(r.category) },
          { label: "Unit", render: (r) => dash(r.unit) },
          { label: "Unit Cost", render: (r) => `₱${Number(r.unitCost).toLocaleString()}` },
          { label: "On Hand", render: (r) => r.totalQuantity ?? 0 },
        ],
        fields: [
          { name: "sku", label: "SKU *", required: true, half: true, get: (r) => r.itemId },
          { name: "category", label: "Category", half: true, get: (r) => r.category },
          { name: "name", label: "Item Name *", required: true, get: (r) => r.name },
          { name: "unit", label: "Unit", half: true, get: (r) => r.unit },
          { name: "unitCost", label: "Unit Cost", type: "number", half: true, get: (r) => r.unitCost },
          { name: "reorderLevel", label: "Reorder Level", type: "number", half: true, get: (r) => r.reorderLevel },
        ],
        toPayload: (p, modal) => {
          // SKU can't be changed after creation (backend updateItem ignores it)
          if (modal.mode === "edit") delete p.sku;
          return p;
        },
      }}
    />
  );
}
