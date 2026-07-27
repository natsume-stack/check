/**
 * 鉴权工具 — 管理后台 Cookie + JWT，LokiBox Bearer token 校验
 */

import { NextRequest } from 'next/server';
import { prisma } from './prisma';
import { signJwt, verifyJwt, type JwtClaims } from './crypto';

const COOKIE_NAME = 'check_session';

// ─── 管理后台：Cookie + JWT ────────────────────────

export async function setSessionCookie(
  claims: JwtClaims
): Promise<string> {
  return signJwt(claims);
}

export function parseCookies(req: NextRequest): Record<string, string> {
  const header = req.headers.get('cookie') ?? '';
  const out: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const [k, ...v] = pair.trim().split('=');
    if (k) out[k] = v.join('=');
  }
  return out;
}

export async function getAdminClaims(
  req: NextRequest
): Promise<JwtClaims | null> {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  return verifyJwt(token);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;

// ─── LokiBox Bearer token 校验 ─────────────────────

/**
 * LokiBox 客户端把 JWT 作为 Bearer token 放在 Authorization 头里
 * 我们在 login/register 时签发 JWT，并把它作为返回的 token
 */
export async function getLokiBoxUser(
  req: NextRequest
): Promise<JwtClaims | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  return verifyJwt(auth.slice(7));
}

// ─── 管理员守卫 ────────────────────────────────────

export async function requireAdmin(
  req: NextRequest
): Promise<JwtClaims | null> {
  const claims = await getAdminClaims(req);
  if (!claims || claims.role !== 'ADMIN') return null;
  return claims;
}

// ─── 在线判定 ──────────────────────────────────────

const ONLINE_THRESHOLD_MS = 60_000; // 60s 内有心跳 = 在线

export async function isUserOnline(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastSeenAt: true },
  });
  if (!user?.lastSeenAt) return false;
  return Date.now() - user.lastSeenAt.getTime() < ONLINE_THRESHOLD_MS;
}

export function onlineThresholdMs(): number {
  return ONLINE_THRESHOLD_MS;
}
