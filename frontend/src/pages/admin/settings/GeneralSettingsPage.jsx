import { SettingsPage } from "../../../components/settings";
import SettingsStub from "./SettingsStub";

export default function GeneralSettingsPage() {
  return (
    <SettingsPage
      eyebrow="System"
      title="General Settings"
      description="Company-wide defaults — localization, trip-ticket numbering, data retention."
    >
      <SettingsStub note="Company-wide configuration lands here once the settings service ships. Your role already has access, so it will appear automatically." />
    </SettingsPage>
  );
}
