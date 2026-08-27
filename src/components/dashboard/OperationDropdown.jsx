import { NavLink } from "react-router-dom";
import "./../../styles/operations.css";

export default function OperationsDropdown({ onClose }) {
  const items = [
    {
      label: "Trips",
      path: "/operations/trips",
    },
    {
      label: "Dispatch",
      path: "/operations/dispatch",
    },
    {
      label: "Live Tracking",
      path: "/operations/live-tracking",
    },
    {
      label: "Exceptions",
      path: "/operations/exceptions",
    },
  ];

  return (
    <div className="operations-dropdown">
      {items.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) =>
            `operations-dropdown-item ${
              isActive ? "operations-dropdown-item-active" : ""
            }`
          }
          onClick={onClose}
        >
          {item.label}
        </NavLink>
      ))}
    </div>
  );
}