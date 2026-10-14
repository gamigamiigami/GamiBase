import { randomBytes } from "node:crypto";
import { emailOf, validEmail, hash } from "./credentials.mjs";
import { supabaseRpc } from "./supabase-api.mjs";
const [command, rawEmail] = process.argv.slice(2),
  email = emailOf(rawEmail);
if (!["issue", "revoke", "restore"].includes(command) || !validEmail(email)) {
  console.error(
    "Usage: npm run license:supabase -- issue|revoke|restore buyer@example.com",
  );
  process.exit(1);
}
try {
  const rpc = supabaseRpc({
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (command === "issue") {
    const code = randomBytes(24).toString("base64url");
    await rpc("issue-license", { email, token: hash(code) });
    console.log(code);
  } else {
    await rpc(command, { email });
    console.log("利用権限を更新しました。");
  }
} catch (error) {
  console.error(error.status ? error.message : "接続設定を確認してください。");
  process.exitCode = 1;
}
