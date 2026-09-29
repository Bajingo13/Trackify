import { layout, greeting, ticket, button, callout, fineprint, textFooter, brandAttachments, e } from "./email.layout.js";

/**
 * The account invitation — the only way a new person is given access. It
 * carries no password: the link opens a page where they confirm their name
 * and choose one themselves. The access details are laid out as a trip
 * ticket, with the invitation's reference number top-right.
 */
export function invitationEmail({
  name, inviterName, role, companyName, branchName, email, expires, url, reference,
}) {
  const hello = name ? `Hi ${name},` : "Hello,";
  const inviter = inviterName || "Your administrator";
  const lead = `${inviter} invited you to Trackify. Set up your account to start managing trips.`;

  const details = [
    ["Role", role || "—"],
    ["Company", companyName || "—"],
    ["Branch", branchName || "All branches"],
    ["Sign-in email", email],
    ["Invited by", inviter],
    ["Expires", expires],
  ];

  const text = [
    "AstreaBlue Intelligence Inc. — Trackify, Trip Ticket Management System",
    `ACCOUNT INVITATION  ${reference}`,
    "",
    hello,
    "",
    lead,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
    "Set up your account:",
    url,
    "",
    "You'll confirm your name and create your own password. Nobody else, including your administrator, will ever see it.",
    "",
    "Not expecting this? Ignore this email and no account will be activated.",
    "AstreaBlue will never ask for your password by email.",
    ...textFooter(),
  ].join("\n");

  const html = layout({
    title: "You're invited to Trackify",
    preheader: `${inviter} added you as ${role || "a Trackify user"}. Set up your account before ${expires}.`,
    tag: "Account invitation",
    reference,
    content: [
      greeting(hello, e(lead)),
      ticket("Trip ticket · Access details", details),
      button(url, "Set up my account"),
      callout("You'll confirm your name and create your own password. <strong>Nobody else, including your administrator, will ever see it.</strong>"),
      fineprint(
        "Not expecting this? Ignore this email and no account will be activated.",
        "AstreaBlue will never ask for your password by email."
      ),
    ].join(""),
  });

  return { subject: "You're invited to Trackify", text, html, attachments: brandAttachments() };
}
