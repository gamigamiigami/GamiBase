import {
  randomBytes,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
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
  const expected = Buffer.from(encoded),
    actual = Buffer.from(await passwordHash(value, salt));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
