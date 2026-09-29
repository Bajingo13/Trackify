import { Check } from "lucide-react";
import { checkPassword } from "../../auth/passwordRules";
import "./password-requirements.css";

/**
 * The live checklist under a new-password field. Each rule is marked by icon
 * and by (screen-reader) text, not colour alone, and the list announces only
 * the summary as it changes rather than every item on every keystroke.
 */
export default function PasswordRequirements({ password, id }) {
  const checks = checkPassword(password);
  const missing = checks.filter((c) => !c.met);

  return (
    <div className="pw-reqs" id={id}>
      <ul aria-label="Password requirements">
        {checks.map((c) => (
          <li key={c.id} className={c.met ? "is-met" : undefined}>
            <span className="pw-reqs-dot" aria-hidden="true">
              <Check size={10} strokeWidth={3.2} />
            </span>
            {c.label}
            <span className="pw-reqs-sr">{c.met ? " (done)" : " (still needed)"}</span>
          </li>
        ))}
      </ul>
      <p className="pw-reqs-sr" aria-live="polite">
        {password
          ? missing.length
            ? `Still needed: ${missing.map((c) => c.label.toLowerCase()).join(", ")}.`
            : "All password requirements met."
          : ""}
      </p>
    </div>
  );
}
