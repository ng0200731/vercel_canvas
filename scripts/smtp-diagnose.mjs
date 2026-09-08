/**
 * SMTP diagnostic for 163.com — isolates whether the problem is credentials /
 * SMTP enablement vs. network. Does NOT send a message, just connects,
 * greets, and attempts AUTH. Fill the two env vars (or pass on the CLI) with
 * the same values used in Vercel.
 *
 *   node scripts/smtp-diagnose.mjs
 *   SMTP_163_USERNAME="xxx@163.com" SMTP_163_PASSWORD="auth-code" node scripts/smtp-diagnose.mjs
 */
import { connect } from "node:tls";

const HOST = "smtp.163.com";
const PORT = 465; // matches the app's 163 provider config (ssl)

const username = process.env.SMTP_163_USERNAME;
const password = process.env.SMTP_163_PASSWORD;

if (!username || !password) {
  console.log("SMTP_163_USERNAME / SMTP_163_PASSWORD not set. Supply them on the CLI.");
  process.exit(1);
}

function run() {
  return new Promise((resolve, reject) => {
    const lines = [];
    const log = (s) => lines.push(s);

    const sock = connect({ host: HOST, port: PORT, rejectUnauthorized: false });
    let buffer = "";
    let stage = "connect"; // connect -> ehlo -> authUser -> authPass -> done
    let done = false;
    let authOk = false;

    sock.on("error", (e) => {
      log(`!! socket/tls error: ${e.message}`);
      finish();
    });
    sock.on("close", () => finish());

    function send(line, redact = false) {
      log(redact ? ">>> (redacted)" : `>>> ${line}`);
      sock.write(line + "\r\n");
    }

    function handle(code, text) {
      log(`<<< ${code} ${text}`);
      if (stage === "connect") {
        if (code === 220) {
          stage = "ehlo";
          send("EHLO diagnose.local");
        } else {
          finish();
        }
      } else if (stage === "ehlo") {
        if (code === 250) {
          stage = "authUser";
          send("AUTH LOGIN");
        } else {
          finish();
        }
      } else if (stage === "authUser") {
        if (code === 334) {
          send(Buffer.from(username).toString("base64"));
          stage = "authPass";
        } else {
          finish();
        }
      } else if (stage === "authPass") {
        if (code === 334) {
          send(Buffer.from(password).toString("base64"), true); // redact the password
          stage = "authVerify";
        } else {
          finish();
        }
      } else if (stage === "authVerify") {
        authOk = code === 235;
        send("QUIT");
        finish();
      }
    }

    function finish() {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch {}
      resolve({ authOk, lines: lines.join("\n") });
    }

    sock.on("data", (data) => {
      buffer += data.toString();
      // SMTP replies: each line terminated by CRLF; last line of a reply has a
      // space at index 3 (single-line replies like "250 ..." have space at 3 too).
      let idx;
      while ((idx = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (line.length >= 3 && !isNaN(parseInt(line[0] + line[1] + line[2], 10))) {
          const code = parseInt(line.slice(0, 3), 10);
          const text = line.length > 4 ? line.slice(4) : "";
          // Only act on the final line of a multi-line reply (space after code)
          const isFinal = line.length === 3 || line[3] === " ";
          if (isFinal) handle(code, text);
          else log(`     ${line.slice(4)}`);
        } else {
          log(`     ${line}`);
        }
      }
    });
  });
}

run().then(({ authOk, lines }) => {
  console.log(lines);
  console.log("\n==================== RESULT ====================");
  console.log(authOk
    ? "AUTH OK — the 163 account + SMTP is valid. Any remaining failure is in the app runtime (Vercel IP / code path)."
    : "AUTH FAILED — 163 server refused login. Check SMTP enabled, authorization code correct, account matches username.");
  process.exit(0);
}).catch((e) => {
  console.error("Diagnostic crashed:", e);
  process.exit(1);
});