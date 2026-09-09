import { Search } from "lucide-react";
import { inputStyle } from "../ui";

/**
 * Controlled search field with a leading icon, styled from the shared token set.
 */
export default function SearchInput({ value, onChange, placeholder = "Search…", width = 280 }) {
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: width }}>
      <Search
        size={14}
        style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)", pointerEvents: "none" }}
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        style={{ ...inputStyle, paddingLeft: 32 }}
      />
    </div>
  );
}
