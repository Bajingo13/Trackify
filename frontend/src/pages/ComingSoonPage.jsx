import { motion } from "motion/react";
import { Hammer } from "lucide-react";
import AppShell from "../components/layout/AppShell";
import { PageHeader, Card } from "../components/ui";

export default function ComingSoonPage({ title }) {
  return (
    <AppShell pageKey={`coming-${title}`}>
      <PageHeader eyebrow="Roadmap" title={title} subtitle="This module is on the plan, not yet built" />
      <Card style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "var(--s-16) var(--s-4)", textAlign: "center" }}>
        <motion.div
          initial={{ scale: 0.6, opacity: 0, rotate: -8 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 20 }}
          style={{ width: 60, height: 60, borderRadius: "var(--r-lg)", background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "var(--s-4)" }}
        >
          <Hammer size={28} />
        </motion.div>
        <h2 style={{ fontSize: "var(--fs-18)", fontWeight: 700, color: "var(--text)", margin: "0 0 6px" }}>Coming soon</h2>
        <p style={{ fontSize: "var(--fs-13)", color: "var(--text-2)", maxWidth: 360, margin: 0, lineHeight: 1.6 }}>
          The <strong style={{ color: "var(--text)" }}>{title}</strong> module is scheduled for a later phase. Its permissions already exist, so it will appear here for the right roles when it ships.
        </p>
      </Card>
    </AppShell>
  );
}
