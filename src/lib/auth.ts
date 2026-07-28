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

// ─── 用户状态校验（加载器核心）─────────────────────

export type UserCheckResult =
  | { ok: true }
  | { ok: false; reason: 'BANNED' | 'EXPIRED' | 'SUSPENDED'; message: string };

/**
 * 检查用户账号状态：是否封禁/到期/暂停
 * 在登录和心跳时都会调用
 */
export async function checkUserStatus(userId: string): Promise<UserCheckResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, bannedReason: true, expiresAt: true },
  });
  if (!user) {
    return { ok: false, reason: 'BANNED', message: '账号不存在' };
  }

  // 检查封禁
  if (user.status === 'BANNED') {
    return {
      ok: false,
      reason: 'BANNED',
      message: user.bannedReason ?? '账号已被封禁',
    };
  }

  // 检查暂停
  if (user.status === 'SUSPENDED') {
    return {
      ok: false,
      reason: 'SUSPENDED',
      message: '账号已被暂停，请联系管理员',
    };
  }

  // 检查到期
  if (user.expiresAt && user.expiresAt < new Date()) {
    // 自动更新状态为 EXPIRED
    await prisma.user.update({
      where: { id: userId },
      data: { status: 'EXPIRED' },
    });
    return {
      ok: false,
      reason: 'EXPIRED',
      message: '账号已到期',
    };
  }

  return { ok: true };
}

/**
 * 获取用户可用的 features 清单（根据 ProgramConfig 过滤）
 * disabled 的 feature 不下发代码包
 */
export async function getAvailableFeatures(): Promise<{
  featureId: string;
  config: unknown;
  enforced: boolean;
  disabled: boolean;
}[]> {
  const configs = await prisma.programConfig.findMany({
    where: { programId: 'lokibox' },
  });
  return configs.map(c => ({
    featureId: c.featureId,
    config: c.config,
    enforced: c.enforced,
    disabled: c.disabled,
  }));
}
