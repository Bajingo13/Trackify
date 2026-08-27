const statusLabels = {
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
};

export default function ExceptionStatusBadge({ status }) {
  const label = statusLabels[status] || status;
  return (
    <span className={`ops-badge ops-exception-${status}`}>
      {label}
    </span>
  );
}
