import nodemailer from "nodemailer";

const host = process.env.SMTP_HOST || "smtp.gmail.com";
const port = Number(process.env.SMTP_PORT || 587);
const secure = (process.env.SMTP_SECURE || "false") === "true";
const user = process.env.SMTP_USERNAME;
const pass = process.env.SMTP_PASSWORD;
const requireTls = (process.env.SMTP_REQUIRE_TLS || "true") === "true";

if (!user || !pass) {
  console.error("Need SMTP_USERNAME / SMTP_PASSWORD");
  process.exit(2);
}

const t = nodemailer.createTransport({
  host,
  port,
  secure, // false -> accept then upgrade via STARTTLS (gmail/163-587)
  requireTLS: requireTls,
  auth: { user, pass },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 15000,
});

console.log(`Testing ${host}:${port} secure=${secure} requireTLS=${requireTls} user=${user}`);
try {
  const ok = await t.verify();
  console.log(ok ? "AUTH OK — login/connection verified." : "AUTH FAILED (verify returned falsy)");
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.log("AUTH FAILED — error from server:");
  console.log(`  code:    ${e.code || e.responseCode || "(none)"}`);
  console.log(`  message: ${e.response || e.message}`);
  process.exit(1);
} finally {
  t.close();
}