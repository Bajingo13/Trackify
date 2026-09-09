import { useState } from "react";
import { SettingsPage, FormSection, Choice } from "../../../components/settings";
import { useToast } from "../../../components/shared/Toast";
import { readTheme, setTheme } from "../../../theme/theme";

function readLS(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeLS(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

export default function PreferencesPage() {
  const { addToast } = useToast();
  const [theme, setThemeState] = useState(readTheme);
  const [navMode, setNavMode] = useState(() => (readLS("tk_nav_mode", "side") === "top" ? "top" : "side"));
  const [sidebar, setSidebar] = useState(() => (readLS("tk_sidebar", "open") === "collapsed" ? "collapsed" : "open"));

  const pickTheme = (v) => setThemeState(setTheme(v));

  const pickNavMode = (v) => {
    setNavMode(v);
    writeLS("tk_nav_mode", v);
    addToast("Navigation layout saved — applies on next page load", "success");
  };

  const pickSidebar = (v) => {
    setSidebar(v);
    writeLS("tk_sidebar", v);
    addToast("Sidebar default saved — applies on next page load", "success");
  };

  return (
    <SettingsPage
      eyebrow="Account"
      title="Preferences"
      description="How Trackify looks and lays out for you on this device."
    >
      <FormSection title="Appearance" description="Colour theme for the console. System follows your operating system.">
        <Choice
          label="Theme"
          value={theme}
          onChange={pickTheme}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "system", label: "System" },
          ]}
        />
      </FormSection>

      <FormSection title="Navigation" description="Where the main menu lives and how the sidebar starts.">
        <Choice
          label="Menu layout"
          value={navMode}
          onChange={pickNavMode}
          options={[
            { value: "side", label: "Sidebar" },
            { value: "top", label: "Top bar" },
          ]}
        />
        <Choice
          label="Sidebar default"
          value={sidebar}
          onChange={pickSidebar}
          options={[
            { value: "open", label: "Expanded" },
            { value: "collapsed", label: "Collapsed" },
          ]}
        />
      </FormSection>
    </SettingsPage>
  );
}
