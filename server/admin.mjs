import { resolve } from "node:path";
import {
  openStore,
  issueLicense,
  emailOf,
  validEmail,
  defaultDataDir,
} from "./store.mjs";
const [command, rawEmail] = process.argv.slice(2),
  email = emailOf(rawEmail);
if (!["issue", "revoke", "restore"].includes(command) || !validEmail(email)) {
  console.error(
    "Usage: npm run license -- issue|revoke|restore buyer@example.com",
  );
  process.exit(1);
}
const db = openStore(
  resolve(process.env.SHIGODEKI_DATA_DIR || defaultDataDir, "app.sqlite"),
);
try {
  if (command === "issue") {
    console.log(issueLicense(db, email));
  } else {
    db.exec("BEGIN IMMEDIATE");
    const result = db
      .prepare("UPDATE users SET active=? WHERE email=?")
      .run(command === "restore" ? 1 : 0, email);
    if (command === "revoke") {
      db.prepare(
        "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email=?)",
      ).run(email);
      db.prepare("DELETE FROM licenses WHERE email=? AND used IS NULL").run(
        email,
      );
    }
    db.exec("COMMIT");
    console.log(
      result.changes
        ? "利用権限を更新しました。"
        : "登録済みアカウントはありません。未使用コードへの処理は完了しました。",
    );
  }
} finally {
  db.close();
}
