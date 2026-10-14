import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
import {
  randomBytes,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const scrypt = promisify(scryptCallback);
// Keep buyer credentials and notebooks outside the static-site checkout.
export const defaultDataDir = fileURLToPath(
  new URL("../../.shigodeki-data/", import.meta.url),
);
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const emailOf = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";
export const validEmail = (email) =>
  email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
export const validPassword = (value) =>
  typeof value === "string" && value.length >= 12 && value.length <= 128;
export async function passwordHash(
  value,
  salt = randomBytes(16).toString("hex"),
) {
  return `${salt}:${(await scrypt(value, salt, 64)).toString("hex")}`;
}
export async function passwordMatches(value, encoded) {
  const [salt] = encoded.split(":");
  return timingSafeEqual(
    Buffer.from(await passwordHash(value, salt)),
    Buffer.from(encoded),
  );
}
export function openStore(path) {
  mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS licenses (token TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS notebooks (user_id TEXT PRIMARY KEY REFERENCES users(id), revision INTEGER NOT NULL, document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS quotes (token TEXT PRIMARY KEY, coupon_hash TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER);
    CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), currency TEXT NOT NULL, list_price INTEGER NOT NULL, coupon_discount INTEGER NOT NULL, applied_discount INTEGER NOT NULL, total INTEGER NOT NULL CHECK(total>=0), created_at INTEGER NOT NULL);`);
  return db;
}
export function issueLicense(db, email) {
  email = emailOf(email);
  if (!validEmail(email))
    throw new Error("有効なメールアドレスを指定してください。");
  const code = randomBytes(24).toString("base64url");
  db.prepare("INSERT INTO licenses(token,email,expires) VALUES(?,?,?)").run(
    hash(code),
    email,
    Date.now() + 30 * 86400000,
  );
  return code;
}
