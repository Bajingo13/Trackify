import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { readTheme, setTheme } from "../../theme/theme";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/** Three-way theme switch. "System" follows the OS setting. */
export default function ThemeToggle() {
  const [theme, setLocal] = useState(readTheme);

  // when on "system", follow the OS if it changes mid-session
  useEffect(() => {
    if (theme !== "system") return;
    let mq;
    try { mq = window.matchMedia("(prefers-color-scheme: dark)"); } catch { return; }
    const onChange = () => setTheme("system");
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [theme]);

  const pick = (v) => { setLocal(setTheme(v)); };

  return (
    <div className="tk-theme-toggle" role="group" aria-label="Colour theme">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`tk-theme-btn ${theme === o.value ? "is-active" : ""}`}
          aria-pressed={theme === o.value}
          title={`${o.label} theme`}
          onClick={() => pick(o.value)}
        >
          <o.icon size={14} />
          <span className="tk-sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
