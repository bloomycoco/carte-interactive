import { cookies } from "next/headers";
import crypto from "node:crypto";

export type SessionRole = "owner" | "admin";

const COOKIE_NAME = "atlas_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 jours

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET manquant");
  return s;
}

function sign(payload: string) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

// Les codes d'accès Owner/Admin ne sont jamais stockés en clair.
export function hashCode(code: string) {
  return crypto.createHash("sha256").update(`${code}:${secret()}`).digest("hex");
}

export async function createSession(role: SessionRole) {
  const payload = `${role}.${Date.now()}`;
  const value = `${payload}.${sign(payload)}`;
  const store = await cookies();
  store.set(COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getSessionRole(): Promise<SessionRole | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [role, ts, sig] = parts;
  if (role !== "owner" && role !== "admin") return null;

  const expected = sign(`${role}.${ts}`);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  return role;
}

export async function requireRole(allowed: SessionRole[]): Promise<SessionRole | null> {
  const role = await getSessionRole();
  if (!role || !allowed.includes(role)) return null;
  return role;
}
