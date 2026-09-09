import { SettingsPage } from "../../../components/settings";
import SettingsStub from "./SettingsStub";

export default function NotificationsPage() {
  return (
    <SettingsPage
      eyebrow="Account"
      title="Notifications"
      description="Which alerts reach you, and how you get them."
    >
      <SettingsStub note="Per-user notification preferences are on the roadmap. For now, in-app alerts follow your role's permissions." />
    </SettingsPage>
  );
}
