import { fileURLToPath } from "node:url";

/**
 * The one look every Trackify email shares: a dark-blue header that fades
 * into the white page, a trip-ticket card, a white body, and a
 * footer with the logo and the operator's address.
 *
 * Table layout and inline styles throughout, because that is all Outlook and
 * Gmail reliably honour. The logo travels inside the message (by cid) rather
 * than being linked, so it shows whether or not the mail client can reach
 * this server; replace assets/email/astreablue-logo.png to change it.
 */

const ISSUER = "AstreaBlue Intelligence Inc.";
export const OPERATOR = {
  name: "Business Set Up & Compliance Inc.",
  address: "20th Floor Unit 2004 Philippine AXA Life Centre, 1286 Sen. Gil Puyat Avenue, Makati City, Philippines",
};

const LOGO_CID = "astreablue-logo";
const LOGO_PATH = fileURLToPath(new URL("../../../assets/email/astreablue-logo.png", import.meta.url));

/** Attach to every message built with `layout`, so `cid:` resolves. */
export const brandAttachments = () => [{ filename: "astreablue-logo.png", path: LOGO_PATH, cid: LOGO_CID }];

/* The system's pixel face (Geist Pixel, as on the sign-in page), used only for
   branding lines and labels; the reading text stays in a plain sans-serif. */
const PIXEL = "'Geist Pixel Square','Silkscreen','Courier New',Consolas,monospace";

/* Everything interpolated here was typed by somebody, so all of it is escaped. */
export const e = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The footer lines of the plain-text version. */
export const textFooter = () => ["", OPERATOR.name, OPERATOR.address, "Automated message. Replies aren't read."];

/** "Hi Paul," heading and the lead paragraph. */
export const greeting = (hello, lead) => `
                <h1 style="margin:20px 0 10px;color:#0c1a38;font-size:22px;line-height:1.3;letter-spacing:-0.3px">${e(hello)}</h1>
                <p style="margin:0 0 22px;color:#44526f;font-size:15px;line-height:1.6">${lead}</p>`;

/** A trip-ticket card of label/value rows. */
export function ticket(heading, rows, { accent = "#2455d6" } = {}) {
  const body = rows
    .map(([label, value], i) => {
      const rule = i ? "border-top:1px solid #e6ebf3;" : "";
      return `
                <tr>
                  <td style="padding:11px 16px;${rule}width:38%;color:#6b7896;font-size:11px;font-weight:700;letter-spacing:0.9px;text-transform:uppercase;vertical-align:top">${e(label)}</td>
                  <td style="padding:11px 16px;${rule}color:#0c1a38;font-size:14px;font-weight:600;word-break:break-word">${e(value)}</td>
                </tr>`;
    })
    .join("");
  return `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #d9e1ee;border-left:5px solid ${accent};border-radius:12px;background:#fbfcfe">
                  <tr>
                    <td colspan="2" style="padding:12px 16px;border-bottom:2px dashed #d9e1ee;color:#0c1a38;font-family:${PIXEL};font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase">${e(heading)}</td>
                  </tr>${body}
                </table>`;
}

/** The main call to action, with the copy-this-link fallback under it. */
export const button = (url, label) => `
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:26px auto 18px">
                  <tr>
                    <td align="center" bgcolor="#2455d6" style="border-radius:10px;background:#2455d6">
                      <a href="${e(url)}" style="display:inline-block;padding:15px 34px;color:#ffffff;text-decoration:none;font-size:15px;line-height:1.2;font-weight:700;letter-spacing:0.2px">${e(label)}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 4px;color:#8a97b1;font-size:12px;line-height:1.5;text-align:center">Button not working? Copy this link:</p>
                <p style="margin:0 0 24px;font-size:12px;line-height:1.5;text-align:center;word-break:break-all"><a href="${e(url)}" style="color:#2455d6;text-decoration:underline">${e(url)}</a></p>`;

/** A tinted callout with a coloured rule on the left. `tone` "info" (blue) or "alert" (red). Content is HTML. */
export function callout(html, { tone = "info" } = {}) {
  const [bg, fg, rule] = tone === "alert" ? ["#fdf1f1", "#8f1f1f", "#d64545"] : ["#f1f5ff", "#33415f", "#2455d6"];
  return `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:22px 0 18px;border-radius:10px;background:${bg};border-left:3px solid ${rule}">
                  <tr>
                    <td style="padding:13px 16px;color:${fg};font-size:13px;line-height:1.55">${html}</td>
                  </tr>
                </table>`;
}

/** Small grey closing lines. */
export const fineprint = (...lines) =>
  lines
    .map((line, i) => `<p style="margin:0 0 ${i === lines.length - 1 ? 26 : 6}px;color:#6b7896;font-size:12.5px;line-height:1.55">${e(line)}</p>`)
    .join("\n                ");

/**
 * The whole page. `tag` is the pill top-left ("Account invitation"),
 * `reference` the monospace code top-right (optional), `content` the body HTML.
 */
export function layout({ title, preheader, tag, reference = "", content }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${e(title)}</title>
    <!-- The pixel face for the branding line. Mail apps that load web fonts use
         it; the rest (Gmail) fall back to a monospace face, which reads the same way. -->
    <link href="https://fonts.googleapis.com/css2?family=Silkscreen&amp;display=swap" rel="stylesheet" />
  </head>
  <body style="margin:0;padding:0;background:#e8edf5;color:#10203d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${e(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#e8edf5">
      <tr>
        <td align="center" style="padding:32px 12px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 18px 45px rgba(12,26,56,0.14)">

            <!-- header: dark blue fading into the white page. The solid navy is
                 the fallback where gradients are not drawn (Outlook). -->
            <tr>
              <td bgcolor="#0b1a3d" style="background-color:#0b1a3d;background-image:linear-gradient(180deg,#0b1a3d 0%,#0f2554 42%,#3d5a9a 68%,#c9d6f0 88%,#ffffff 100%);padding:34px 32px 58px">
                <div style="font-size:10.5px;line-height:1.4;font-weight:600;letter-spacing:2.4px;text-transform:uppercase;color:#9fb8f5">${e(ISSUER)}</div>
                <div style="margin-top:8px;font-size:28px;line-height:1.15;font-weight:800;letter-spacing:-0.5px;color:#ffffff">Trackify</div>
                <div style="margin-top:6px;font-family:${PIXEL};font-size:11px;line-height:1.5;letter-spacing:1.8px;text-transform:uppercase;color:#dbe5ff">Trip Ticket Management System</div>
              </td>
            </tr>

            <!-- body -->
            <tr>
              <td style="padding:6px 32px 8px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td><span style="display:inline-block;padding:6px 10px;border-radius:6px;background:#eef3ff;color:#1d4ed8;font-family:${PIXEL};font-size:10.5px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase">${e(tag)}</span></td>
                    <td align="right" style="color:#8a97b1;font-family:${PIXEL};font-size:11px;letter-spacing:1px">${e(reference)}</td>
                  </tr>
                </table>
${content}
              </td>
            </tr>

            <!-- footer: end of the road -->
            <tr>
              <td style="padding:0 32px"><div style="border-top:2px dashed #d9e1ee;height:0;line-height:0;font-size:0">&nbsp;</div></td>
            </tr>
            <tr>
              <td style="padding:22px 32px 28px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="146" valign="middle" style="padding-right:16px"><img src="cid:${LOGO_CID}" width="130" alt="AstreaBlue" style="display:block;width:130px;height:auto;border:0" /></td>
                    <td valign="middle" style="color:#6b7896;font-size:11.5px;line-height:1.55">
                      <strong style="color:#0c1a38;font-size:12.5px">${e(OPERATOR.name)}</strong><br />
                      ${e(OPERATOR.address)}<br />
                      <span style="color:#98a3b9">Automated message. Replies aren't read.</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
