import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { db, User } from './db';

const JWT_SECRET   = process.env.JWT_SECRET ?? 'modaya-dev-secret-change-in-production';
const COOKIE_NAME  = 'modaya_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// ── Token payload ─────────────────────────────────────────────────────────────
// We embed the full safe-user in the JWT so sessions are self-contained.
// On serverless runtimes the DB Map may be empty on a new lambda instance —
// the JWT is the source of truth for who is logged in.

export interface TokenPayload {
  userId: string;
  email:  string;
  name:   string;
  plan:   string;
}

// ── Password ──────────────────────────────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10); // cost 10 — faster on serverless cold starts
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ── JWT ───────────────────────────────────────────────────────────────────────

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   COOKIE_MAX_AGE,
    path:     '/',
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value ?? null;
}

// ── Current user ─────────────────────────────────────────────────────────────
// Reads identity from the JWT — no DB lookup required for auth.
// Falls back to DB lookup to get up-to-date plan/storage fields.

export async function getCurrentUser(): Promise<User | null> {
  const token = await getSessionToken();
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;

  // Try DB first (has latest data); fall back to JWT payload (serverless cold start)
  const dbUser = db.users.findById(payload.userId);
  if (dbUser) return dbUser;

  // Reconstruct a minimal User from the JWT payload so routes still work
  return {
    id:            payload.userId,
    email:         payload.email,
    name:          payload.name,
    passwordHash:  '',           // not needed — already authenticated via JWT
    createdAt:     new Date().toISOString(),
    plan:          (payload.plan as User['plan']) ?? 'starter',
    storageUsedMb: 0,
  };
}

// ── Safe user (no password hash) ─────────────────────────────────────────────

export type SafeUser = Omit<User, 'passwordHash'>;

export function toSafeUser(u: User): SafeUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash: _, ...safe } = u;
  return safe;
}
