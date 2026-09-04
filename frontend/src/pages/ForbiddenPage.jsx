import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ShieldOff } from "lucide-react";
import AppShell from "../components/layout/AppShell";
import { Card, Button } from "../components/ui";

export default function ForbiddenPage() {
  const navigate = useNavigate();
  return (
    <AppShell pageKey="forbidden">
      <Card style={{ maxWidth: 440, margin: "var(--s-12) auto", padding: "var(--s-8)", textAlign: "center" }}>
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          style={{ width: 52, height: 52, borderRadius: "var(--r-md)", margin: "0 auto var(--s-4)", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--danger-soft)", color: "var(--danger)" }}
        >
          <ShieldOff size={24} />
        </motion.div>
        <h1 style={{ fontSize: "var(--fs-18)", fontWeight: 700, color: "var(--text)", margin: "0 0 6px" }}>
          You don't have access to this page
        </h1>
        <p style={{ fontSize: "var(--fs-13)", color: "var(--text-2)", margin: "0 0 var(--s-5)" }}>
          Your role doesn't include the permission this screen needs. Ask a company administrator if you think this is a mistake.
        </p>
        <Button variant="primary" onClick={() => navigate("/dashboard")}>Back to dashboard</Button>
      </Card>
    </AppShell>
  );
}
