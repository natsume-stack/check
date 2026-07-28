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

// ─── 分级守卫 ────────────────────────────────────
//
// 角色权限矩阵：
//   USER        → 仪表盘（只读统计）
//   AGENT       → 仪表盘 + 用户管理（不能改 role，不能操作 SUPER_ADMIN/其他 AGENT）
//   SUPER_ADMIN → 全量开放

import type { Role } from './crypto';

/** 权限等级数值，用于比较 */
const ROLE_LEVEL: Record<Role, number> = {
  USER: 0,
  AGENT: 1,
  SUPER_ADMIN: 2,
};

/** 仅超级管理员（程序管理、代码包上传等敏感操作） */
export async function requireSuperAdmin(
  req: NextRequest
): Promise<JwtClaims | null> {
  const claims = await getAdminClaims(req);
  if (!claims || claims.role !== 'SUPER_ADMIN') return null;
  return claims;
}

/** 任何已登录用户（仪表盘 stats 等只读接口） */
export async function requireUser(
  req: NextRequest
): Promise<JwtClaims | null> {
  return getAdminClaims(req);
}

/** 代理或超级管理员（用户管理类操作） */
export async function requireAgent(
  req: NextRequest
): Promise<JwtClaims | null> {
  const claims = await getAdminClaims(req);
  if (!claims) return null;
  if (claims.role !== 'AGENT' && claims.role !== 'SUPER_ADMIN') return null;
  return claims;
}

/** LokiBox Bearer token 版本：仅超级管理员（/admin/pack 上传代码包用） */
export async function requireLokiBoxSuperAdmin(
  req: NextRequest
): Promise<JwtClaims | null> {
  const claims = await getLokiBoxUser(req);
  if (!claims || claims.role !== 'SUPER_ADMIN') return null;
  return claims;
}

/**
 * 越权防护：判断 actor 是否可以操作 target 用户。
 *
 * 规则：
 *   - 不能操作自己（ban/suspend/delete 场景；查看允许）
 *   - AGENT 不能操作 SUPER_ADMIN 或其他 AGENT
 *   - SUPER_ADMIN 可以操作所有人（除自己外的删除/封禁）
 */
export function canManageUser(
  actor: JwtClaims,
  targetRole: Role,
  opts: { allowSelf?: boolean } = {}
): { ok: true } | { ok: false; reason: string } {
  const { allowSelf = false } = opts;

  // actor 自身角色校验（USER 根本不该到这里）
  if (actor.role === 'USER') {
    return { ok: false, reason: 'Insufficient permissions' };
  }

  // AGENT 不能操作 SUPER_ADMIN 或其他 AGENT
  if (actor.role === 'AGENT') {
    if (ROLE_LEVEL[targetRole] >= ROLE_LEVEL[actor.role]) {
      return {
        ok: false,
        reason: 'Agents cannot operate on admins or other agents',
      };
    }
  }

  // self 检查由调用方决定（查看自己允许，封禁/删除自己禁止）
  if (!allowSelf) {
    // 注意：调用方需要自行比较 actor.sub 与 target.id，本函数只做角色校验
    // 这里返回 ok=true，由调用方再做 self 校验
  }

  return { ok: true };
}

/**
 * 修改 role 的权限校验。
 *
 * 规则：
 *   - 只有 SUPER_ADMIN 能修改 role
 *   - AGENT 完全不能修改 role
 *   - SUPER_ADMIN 不能降级自己（防止误操作锁死）
 *   - 不能把最后一个 SUPER_ADMIN 降级（需调用方先 count）
 */
export function canChangeRole(
  actor: JwtClaims,
  targetId: string,
  _targetCurrentRole: Role,
  newRole: Role
): { ok: true } | { ok: false; reason: string } {
  if (actor.role !== 'SUPER_ADMIN') {
    return { ok: false, reason: 'Only super admin can change roles' };
  }

  // 不允许降级自己（防止误操作锁死）
  if (actor.sub === targetId && ROLE_LEVEL[newRole] < ROLE_LEVEL.SUPER_ADMIN) {
    return {
      ok: false,
      reason: 'Cannot demote yourself',
    };
  }

  return { ok: true };
}

/** 向后兼容：requireAdmin = requireSuperAdmin（旧 API 仍可用） */
export async function requireAdmin(
  req: NextRequest
): Promise<JwtClaims | null> {
  return requireSuperAdmin(req);
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
