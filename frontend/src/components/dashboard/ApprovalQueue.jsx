import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Receipt, ArrowLeftRight, ChevronRight } from "lucide-react";
import { getAllTrips } from "../../services/operations/tripService";
import { voucherApi } from "../../services/finance/financeService";
import { getTransferStats } from "../../services/warehouse/branchTransferService";
import { usePermissions } from "../../auth/permissions";

const PENDING = ["for_validation", "for_approval"];

export default function ApprovalQueue() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [tripPending, setTripPending] = useState(null);
  const [voucherPending, setVoucherPending] = useState(null);
  const [transferPending, setTransferPending] = useState(null);

  useEffect(() => {
    if (!can("trip.read")) return;
    getAllTrips({ limit: 1000 })
      .then((trips) => setTripPending(trips.filter((t) => PENDING.includes(t.status)).length))
      .catch(() => setTripPending(0));
  }, [can]);

  useEffect(() => {
    if (!can("voucher.approve")) return;
    voucherApi
      .stats()
      .then((stats) => setVoucherPending(Number(stats?.awaitingApproval) || 0))
      .catch(() => setVoucherPending(0));
  }, [can]);

  useEffect(() => {
    if (!can("transfer.manage")) return;
    getTransferStats()
      .then((stats) => setTransferPending(Number(stats?.pending) || 0))
      .catch(() => setTransferPending(0));
  }, [can]);

  const rows = [
    {
      type: "Trip Tickets",
      count: tripPending,
      detail:
        tripPending == null
          ? "Loading…"
          : tripPending === 0
          ? "Nothing awaiting review"
          : "Awaiting validation or approval",
      icon: <FileText size={16} style={{ color: "#2455D6" }} />,
      bg: "#EEF4FF",
      to: "/operations/trips",
      show: can("trip.read"),
    },
    {
      type: "Expense Vouchers",
      count: voucherPending,
      detail:
        voucherPending == null
          ? "Loading…"
          : voucherPending === 0
          ? "Nothing awaiting approval"
          : "Submitted for approval",
      icon: <Receipt size={16} style={{ color: "#1F4BC6" }} />,
      bg: "#E8F0FE",
      to: "/finance/expense-vouchers",
      show: can("voucher.approve"),
    },
    {
      type: "Branch Transfers",
      count: transferPending,
      detail:
        transferPending == null
          ? "Loading…"
          : transferPending === 0
          ? "Nothing awaiting action"
          : "Draft or approved transfers",
      icon: <ArrowLeftRight size={16} style={{ color: "#102F8A" }} />,
      bg: "#EDF2FF",
      to: "/warehouse/transfers",
      show: can("transfer.manage"),
    },
  ].filter((r) => r.show);

  const queueTarget = rows.find((row) => Number(row.count) > 0)?.to || rows[0]?.to;

  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-base" style={{ color: "var(--trackify-text)" }}>
          Approval Queue
        </span>
        {queueTarget && (
          <button
            className="text-xs font-semibold transition-opacity hover:opacity-70"
            style={{ color: "var(--trackify-blue)" }}
            onClick={() => navigate(queueTarget)}
          >
            View queue
          </button>
        )}
      </div>

      <div className="flex flex-col divide-y" style={{ borderColor: "var(--trackify-border-soft)" }}>
        {rows.length === 0 && (
          <div className="text-xs py-3" style={{ color: "var(--trackify-text-secondary)" }}>
            Nothing to approve for your role.
          </div>
        )}
        {rows.map((item) => (
          <button
            type="button"
            key={item.type}
            className="flex w-full items-center justify-between gap-3 py-3 first:pt-0 group cursor-pointer text-left"
            onClick={() => navigate(item.to)}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-opacity group-hover:opacity-80"
                style={{ background: item.bg }}
              >
                {item.icon}
              </div>
              <div>
                <div className="text-sm font-semibold leading-tight" style={{ color: "var(--trackify-text)" }}>
                  {item.count} {item.type}
                </div>
                <div className="text-xs mt-0.5" style={{ color: "var(--trackify-text-secondary)" }}>
                  {item.detail}
                </div>
              </div>
            </div>
            <ChevronRight
              size={14}
              style={{ color: "var(--trackify-text-muted)" }}
              className="flex-shrink-0 opacity-50 group-hover:opacity-100 transition-opacity"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
