import { Info, Landmark, DollarSign, CreditCard, Star } from "lucide-react";
import { accounts } from "../../data/dashboardData";

const icons = {
  bank: <Landmark size={16} className="text-white" />,
  dollar: <DollarSign size={16} className="text-white" />,
  card: <CreditCard size={16} className="text-white" />,
  star: <Star size={16} className="text-white" />,
};

export default function AccountOverview() {
  return (
    <div className="card p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-base" style={{ color: "#101B3D" }}>Account Overview</span>
          <button aria-label="Account overview info" className="opacity-50 hover:opacity-80 transition-opacity">
            <Info size={14} />
          </button>
        </div>
        <button className="text-xs font-semibold transition-opacity hover:opacity-70" style={{ color: "#1464F4" }}>
          View all
        </button>
      </div>

      <div className="flex flex-col divide-y" style={{ borderColor: "rgba(20,100,244,0.08)" }}>
        {accounts.map((account) => (
          <div
            key={account.id}
            className="flex items-center justify-between gap-3 py-3 first:pt-0 cursor-pointer group"
          >
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-opacity group-hover:opacity-80"
                style={{ background: account.iconBg }}
              >
                {icons[account.icon]}
              </div>
              <div>
                <div className="text-sm font-semibold leading-tight" style={{ color: "#101B3D" }}>
                  {account.name}
                </div>
                <div className="text-xs mt-0.5" style={{ color: "#6F7894" }}>
                  {account.masked}
                </div>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              {account.points ? (
                <>
                  <div className="text-sm font-semibold" style={{ color: "#101B3D" }}>
                    {account.points.toLocaleString()} pts
                  </div>
                  <div className="text-xs" style={{ color: "#6F7894" }}>
                    ${account.balance.toLocaleString()} value
                  </div>
                </>
              ) : (
                <>
                  <div className="text-sm font-semibold" style={{ color: "#101B3D" }}>
                    ${account.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-[11px] font-medium" style={{ color: "#16A34A" }}>
                    Available
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Total */}
      <div
        className="flex items-center justify-between pt-3 border-t"
        style={{ borderColor: "rgba(20,100,244,0.1)" }}
      >
        <span className="text-sm font-semibold" style={{ color: "#101B3D" }}>Total Balance</span>
        <span className="text-lg font-bold" style={{ color: "#101B3D" }}>$768,431.25</span>
      </div>
    </div>
  );
}
