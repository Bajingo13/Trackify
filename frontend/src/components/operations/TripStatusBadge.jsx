const statusLabels = {
  draft: "Draft",
  validated: "Validated",
  for_approval: "For Approval",
  approved: "Approved",
  assigned: "Assigned",
  accepted: "Accepted",
  released: "Released",
  in_transit: "In Transit",
  delivered: "Delivered",
  returned: "Returned",
  operationally_closed: "Closed",
  cancelled: "Cancelled",
  rejected: "Rejected",
};

export default function TripStatusBadge({ status }) {
  const label = statusLabels[status] || status;
  return (
    <span className={`ops-badge ops-badge-${status}`}>
      {label}
    </span>
  );
}
