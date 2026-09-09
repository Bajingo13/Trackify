import { Outlet } from "react-router-dom";
import AppShell from "../../../components/layout/AppShell";
import { PageHeader, Card } from "../../../components/ui";
import { SettingsSidebar } from "../../../components/settings";
import useMediaQuery from "../../../hooks/useMediaQuery";

/**
 * Frame for the Settings workspace: the standard app shell, a page header, and
 * a persistent rail beside the routed panel. Only the panel changes as you move
 * between sections. Below 900px the rail becomes a chip row above the panel.
 */
export default function SettingsLayout() {
  const compact = useMediaQuery("(max-width: 900px)");

  return (
    <AppShell pageKey="settings">
      <PageHeader
        eyebrow="Administration Workspace"
        title="Settings"
        subtitle="Account preferences and system configuration, organized by purpose."
      />

      <Card pad="0" style={{ overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            flexDirection: compact ? "column" : "row",
            alignItems: "stretch",
            minHeight: compact ? undefined : "min(70vh, 640px)",
          }}
        >
          <SettingsSidebar />
          <div style={{ flex: 1, minWidth: 0, padding: compact ? "var(--s-4)" : "var(--s-6)" }}>
            <Outlet />
          </div>
        </div>
      </Card>
    </AppShell>
  );
}
