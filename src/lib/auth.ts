/**
 * 鉴权工具 — 双账户系统
 *
 * - AdminUser（管理后台）：Cookie + JWT（type='admin'）
 * - LokiUser（LokiBox 客户端）：Bearer token + JWT（type='loki'）
 *
 * 防越权：
 *   - admin token 不能访问 LokiBox 加密 API
 *   - loki token 不能访问管理后台 API
 *   - 通过 JWT claims.type 严格区分
 */

import { NextRequest } from 'next/server';
import { prisma } from './prisma';
import {
  signJwt,
  verifyJwt,
  type AdminJwtClaims,
  type LokiJwtClaims,
  type JwtClaims,
  type Role,
} from './crypto';

const COOKIE_NAME = 'check_session';

// ─── 管理后台：Cookie + JWT ────────────────────────

export async function setSessionCookie(
  claims: AdminJwtClaims
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

/** 从 cookie 解析 admin JWT，校验 type='admin' */
export async function getAdminClaims(
  req: NextRequest
): Promise<AdminJwtClaims | null> {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const claims = await verifyJwt(token);
  if (!claims || claims.type !== 'admin') return null;
  return claims;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;

// ─── LokiBox Bearer token 校验 ─────────────────────

/** 从 Authorization header 解析 loki JWT，校验 type='loki' */
export async function getLokiBoxUser(
  req: NextRequest
): Promise<LokiJwtClaims | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const claims = await verifyJwt(auth.slice(7));
  if (!claims || claims.type !== 'loki') return null;

  // ── Session 绑定校验 ──
  // JWT 必须包含 sid（sessionId），且与请求头 X-Session-Id 一致
  // 防止被盗的 JWT 与新 session 配合使用
  if (claims.sid) {
    const requestSessionId = req.headers.get('X-Session-Id');
    if (!requestSessionId || requestSessionId !== claims.sid) {
      return null; // Session 不匹配，拒绝
    }

    // 检查 session 是否仍然有效（未被吊销、未过期）
    const session = await prisma.session.findUnique({
      where: { id: claims.sid },
      select: { revokedAt: true, expiresAt: true, userId: true },
    }).catch(() => null);

    if (!session) return null; // Session 不存在
    if (session.revokedAt) return null; // Session 已被吊销
    if (session.expiresAt <= new Date()) return null; // Session 已过期
    if (session.userId !== claims.sub) return null; // Session 不属于该用户
  }

  // ── 设备指纹校验 ──
  // 请求头 X-Fingerprint 携带当前设备指纹，必须与 JWT 中的指纹一致
  // 防止被盗的 JWT 在不同设备上使用
  if (claims.fp) {
    const requestFp = req.headers.get('X-Fingerprint');
    if (!requestFp || requestFp !== claims.fp) {
      return null; // 指纹不匹配，拒绝
    }
  }

  // ── 设备/IP 黑名单检查（封禁连坐）──
  const requestIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
    ?? req.headers.get('x-real-ip') ?? '';
  const requestFp = req.headers.get('X-Fingerprint');

  if (requestFp || requestIp) {
    const blacklist = await prisma.deviceBlacklist.findFirst({
      where: {
        OR: [
          ...(requestFp ? [{ fingerprint: requestFp }] : []),
          ...(requestIp ? [{ ip: requestIp }] : []),
        ],
      },
    }).catch(() => null);

    if (blacklist) {
      return null; // 设备/IP 在黑名单中，拒绝
    }
  }

  return claims;
}

// ─── 分级守卫（仅 AdminUser 有 role）─────────────────

const ROLE_LEVEL: Record<Role, number> = {
  USER: 0,
  AGENT: 1,
  SUPER_ADMIN: 2,
};

/** 仅超级管理员（程序管理、代码包上传、AdminUser 管理等） */
export async function requireSuperAdmin(
  req: NextRequest
): Promise<AdminJwtClaims | null> {
  const claims = await getAdminClaims(req);
  if (!claims || claims.role !== 'SUPER_ADMIN') return null;
  return claims;
}

/** 任何已登录后台用户（仪表盘 stats 等只读接口） */
export async function requireUser(
  req: NextRequest
): Promise<AdminJwtClaims | null> {
  return getAdminClaims(req);
}

/** 代理或超级管理员（LokiUser 管理类操作） */
export async function requireAgent(
  req: NextRequest
): Promise<AdminJwtClaims | null> {
  const claims = await getAdminClaims(req);
  if (!claims) return null;
  if (claims.role !== 'AGENT' && claims.role !== 'SUPER_ADMIN') return null;
  return claims;
}

/** LokiBox Bearer token 版本：仅超级管理员（/admin/pack 上传代码包用） */
export async function requireLokiBoxSuperAdmin(
  req: NextRequest
): Promise<AdminJwtClaims | null> {
  // /admin/pack 用 Bearer token，但必须是 admin token
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const claims = await verifyJwt(auth.slice(7));
  if (!claims || claims.type !== 'admin' || claims.role !== 'SUPER_ADMIN') return null;
  return claims;
}

// ─── 越权防护 ────────────────────────────────────

/**
 * 判断 actor 是否可以操作 target LokiUser。
 * 规则：
 *   - USER 角色不能操作（无权限）
 *   - AGENT / SUPER_ADMIN 可以操作 LokiUser（LokiUser 没有 role 概念）
 *   - LokiUser 操作不需要 self 检查（admin 不会是 LokiUser）
 */
export function canManageLokiUser(
  actor: AdminJwtClaims
): { ok: true } | { ok: false; reason: string } {
  if (actor.role === 'USER') {
    return { ok: false, reason: 'Insufficient permissions' };
  }
  return { ok: true };
}

/**
 * 判断 actor 是否可以操作 target AdminUser（修改角色、删除等）。
 * 规则：
 *   - 只有 SUPER_ADMIN 能管理 AdminUser
 *   - 不能降级自己（防止锁死）
 *   - 不能降级最后一个 SUPER_ADMIN
 */
export function canManageAdminUser(
  actor: AdminJwtClaims,
  targetId: string,
  _targetCurrentRole: Role,
  newRole?: Role
): { ok: true } | { ok: false; reason: string } {
  if (actor.role !== 'SUPER_ADMIN') {
    return { ok: false, reason: 'Only super admin can manage admin users' };
  }

  // 不允许降级自己
  if (actor.sub === targetId && newRole && ROLE_LEVEL[newRole] < ROLE_LEVEL.SUPER_ADMIN) {
    return {
      ok: false,
      reason: 'Cannot demote yourself',
    };
  }

  return { ok: true };
}

// ─── 在线判定 ──────────────────────────────────────

const ONLINE_THRESHOLD_MS = 60_000; // 60s 内有心跳 = 在线

export async function isUserOnline(userId: string): Promise<boolean> {
  const user = await prisma.lokiUser.findUnique({
    where: { id: userId },
    select: { lastSeenAt: true },
  });
  if (!user?.lastSeenAt) return false;
  return Date.now() - user.lastSeenAt.getTime() < ONLINE_THRESHOLD_MS;
}

export function onlineThresholdMs(): number {
  return ONLINE_THRESHOLD_MS;
}

// ─── 设备指纹验证（防 token 盗用）────────────────────

/**
 * 验证 JWT 中的设备指纹是否与数据库存储的一致
 * 防止被盗的 JWT 在不同设备上使用
 */
export async function validateFingerprint(userId: string, fp?: string): Promise<boolean> {
  if (!fp) return false;
  const user = await prisma.lokiUser.findUnique({
    where: { id: userId },
    select: { fingerprint: true },
  });
  if (!user?.fingerprint) return true; // 未记录指纹，放行（兼容旧数据）
  return user.fingerprint === fp;
}

// ─── LokiUser 状态校验（加载器核心）─────────────────────

export type UserCheckResult =
  | { ok: true }
  | { ok: false; reason: 'BANNED' | 'EXPIRED' | 'SUSPENDED'; message: string };

/**
 * 检查 LokiUser 账号状态：是否封禁/到期/暂停
 * 在登录和心跳时都会调用
 */
export async function checkUserStatus(userId: string): Promise<UserCheckResult> {
  const user = await prisma.lokiUser.findUnique({
    where: { id: userId },
    select: { status: true, bannedReason: true, expiresAt: true },
  });
  if (!user) {
    return { ok: false, reason: 'BANNED', message: '账号不存在' };
  }

  if (user.status === 'BANNED') {
    return {
      ok: false,
      reason: 'BANNED',
      message: user.bannedReason ?? '账号已被封禁',
    };
  }

  if (user.status === 'SUSPENDED') {
    return {
      ok: false,
      reason: 'SUSPENDED',
      message: '账号已被暂停，请联系管理员',
    };
  }

  if (user.expiresAt && user.expiresAt < new Date()) {
    await prisma.lokiUser.update({
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

// ─── 暴力破解防护 ──────────────────────────────────

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 分钟

/** 记录登录失败，达到阈值则锁定 */
export async function recordFailedLogin(userId: string, isLoki: boolean): Promise<void> {
  const model = isLoki ? prisma.lokiUser : prisma.adminUser;
  const user = await (model as any).findUnique({
    where: { id: userId },
    select: { failedLoginAttempts: true },
  });
  if (!user) return;

  const attempts = user.failedLoginAttempts + 1;
  const shouldLock = attempts >= MAX_LOGIN_ATTEMPTS;

  await (model as any).update({
    where: { id: userId },
    data: {
      failedLoginAttempts: attempts,
      ...(shouldLock ? { lockedUntil: new Date(Date.now() + LOCK_DURATION_MS) } : {}),
    },
  });
}

/** 检查账号是否被锁定 */
export async function isAccountLocked(
  userId: string,
  isLoki: boolean
): Promise<{ locked: boolean; remainingMs?: number }> {
  const model = isLoki ? prisma.lokiUser : prisma.adminUser;
  const user = await (model as any).findUnique({
    where: { id: userId },
    select: { lockedUntil: true },
  });
  if (!user?.lockedUntil) return { locked: false };

  const now = Date.now();
  const lockedUntil = user.lockedUntil.getTime();
  if (now >= lockedUntil) {
    // 锁定已过期，重置计数
    await (model as any).update({
      where: { id: userId },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
    return { locked: false };
  }

  return { locked: true, remainingMs: lockedUntil - now };
}

/** 登录成功后重置失败计数 */
export async function resetLoginAttempts(userId: string, isLoki: boolean): Promise<void> {
  const model = isLoki ? prisma.lokiUser : prisma.adminUser;
  await (model as any).update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
}

export const LOGIN_SECURITY = {
  MAX_LOGIN_ATTEMPTS,
  LOCK_DURATION_MS,
} as const;

// ─── 向后兼容 ──────────────────────────────────────

export async function requireAdmin(
  req: NextRequest
): Promise<AdminJwtClaims | null> {
  return requireSuperAdmin(req);
}

/** @deprecated 用 canManageLokiUser 替代 */
export function canManageUser(
  actor: AdminJwtClaims
): { ok: true } | { ok: false; reason: string } {
  return canManageLokiUser(actor);
}

/** @deprecated 旧接口保留 */
export function canChangeRole(
  actor: AdminJwtClaims,
  targetId: string,
  _targetCurrentRole: Role,
  newRole: Role
): { ok: true } | { ok: false; reason: string } {
  return canManageAdminUser(actor, targetId, _targetCurrentRole, newRole);
}

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

// 重新导出 JwtClaims 以兼容旧代码
export type { JwtClaims };
