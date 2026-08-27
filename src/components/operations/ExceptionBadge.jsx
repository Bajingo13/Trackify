const severityLabels = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

export default function ExceptionBadge({ severity }) {
  const label = severityLabels[severity] || severity;
  return (
    <span className={`ops-badge ops-severity-${severity}`}>
      {label}
    </span>
  );
}
