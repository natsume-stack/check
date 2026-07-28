/**
 * 网络安全工具集 — 防 CSRF / 限流 / 自阻止 / 敏感字段过滤
 *
 * 设计目标：
 *   1. CSRF 防护：管理后台所有 state-changing 请求必须带 X-Requested-With 自定义头
 *      （浏览器同源策略会阻止跨域请求附带自定义头，除非 CORS 显式允许）
 *   2. IP 限流：登录/注册接口的 IP 维度限流，防止扫描爆破
 *   3. 自阻止：admin 不能对自己执行危险操作（封禁/暂停/删除）
 *   4. 敏感字段过滤：响应中不返回 passwordHash / sessionKey / 等字段
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from './prisma';

// ─── CSRF 防护：自定义头校验 ─────────────────────

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF 检查：所有 state-changing 请求必须带 X-Requested-With 头
 * 浏览器同源策略会阻止跨域请求附带自定义头（除非 CORS 显式允许）
 *
 * 仅适用于管理后台 API（/api/admin/*、/api/auth/*），LokiBox 加密 API 自带加密验证
 */
export function checkCsrf(req: NextRequest): boolean {
  if (!STATE_CHANGING_METHODS.has(req.method)) return true;
  const xrw = req.headers.get('x-requested-with');
  return xrw === 'XMLHttpRequest' || xrw === 'check-admin';
}

export function csrfErrorResponse(): NextResponse {
  return NextResponse.json(
    { error: 'CSRF check failed: missing X-Requested-With header' },
    { status: 403 }
  );
}

// ─── IP 限流（DB 持久化 + 内存快速路径）────────────

interface RateBucket {
  count: number;
  resetAt: number;
}

// 进程内限流（快速路径，Vercel Serverless 每个实例独立）
const IP_BUCKETS = new Map<string, RateBucket>();

// 定期清理过期 bucket（每 5 分钟）
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupBuckets() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, bucket] of IP_BUCKETS) {
    if (now > bucket.resetAt) IP_BUCKETS.delete(key);
  }
}

export interface RateLimitOptions {
  /** 时间窗口（ms），默认 60s */
  windowMs?: number;
  /** 窗口内最大请求数，默认 10 */
  max?: number;
  /** 标识符前缀（如 'login'、'register'），避免不同接口互相影响 */
  key: string;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * DB 持久化限流 — 跨 Serverless 实例共享计数。
 *
 * 使用 upsert 原子操作：如果桶不存在则创建（count=1），
 * 如果存在则 count+1。窗口过期后自动重置。
 *
 * 安全策略：DB 故障时 fail-closed（拒绝请求），防止限流被绕过。
 */
export async function checkRateLimit(
  ip: string,
  opts: RateLimitOptions
): Promise<RateLimitResult> {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 10;
  const now = Date.now();
  const bucketKey = `${opts.key}:${ip}`;
  const expiresAt = new Date(now + windowMs);
  const nowDate = new Date(now);

  // 内存快速路径：同实例内高频请求先拦截
  cleanupBuckets();
  const memBucket = IP_BUCKETS.get(bucketKey);
  if (memBucket && now <= memBucket.resetAt) {
    memBucket.count++;
    if (memBucket.count > max) {
      return { ok: false, remaining: 0, resetAt: memBucket.resetAt };
    }
  } else {
    IP_BUCKETS.set(bucketKey, { count: 1, resetAt: now + windowMs });
  }

  // DB 权威计数 — 使用原子 INSERT ... ON DUPLICATE KEY UPDATE 防止竞态条件
  // 单条 SQL 完成：不存在则创建(count=1)，已过期则重置(count=1)，未过期则递增(count+1)
  try {
    await prisma.$executeRaw`
      INSERT INTO RateLimitBucket (id, bucketKey, count, windowStart, expiresAt)
      VALUES (UUID(), ${bucketKey}, 1, ${nowDate}, ${expiresAt})
      ON DUPLICATE KEY UPDATE
        count = IF(expiresAt < ${nowDate}, 1, count + 1),
        windowStart = IF(expiresAt < ${nowDate}, ${nowDate}, windowStart),
        expiresAt = IF(expiresAt < ${nowDate}, ${expiresAt}, expiresAt)
    `;

    // 读取更新后的计数
    const bucket = await prisma.rateLimitBucket.findUnique({
      where: { bucketKey },
      select: { count: true, expiresAt: true },
    });

    if (!bucket) {
      // 极端情况：INSERT 和 ON DUPLICATE KEY UPDATE 都没生效
      return { ok: true, remaining: max - 1, resetAt: now + windowMs };
    }

    if (bucket.count > max) {
      return { ok: false, remaining: 0, resetAt: bucket.expiresAt.getTime() };
    }

    return {
      ok: true,
      remaining: max - bucket.count,
      resetAt: bucket.expiresAt.getTime(),
    };
  } catch {
    // DB 故障时 fail-closed：拒绝请求（防止限流被绕过）
    return {
      ok: false,
      remaining: 0,
      resetAt: now + windowMs,
    };
  }
}

export function rateLimitResponse(result: RateLimitResult): NextResponse {
  const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
  return NextResponse.json(
    { error: 'Too many requests' },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.floor(result.resetAt / 1000)),
      },
    }
  );
}

// ─── 自阻止防护 ───────────────────────────────────

/**
 * 检查 actor 是否对自己执行操作
 * 用于：封禁/暂停/删除等危险操作
 */
export function isSelfAction(
  actorId: string,
  targetId: string
): boolean {
  return actorId === targetId;
}

// ─── 敏感字段过滤 ─────────────────────────────────

const SENSITIVE_FIELDS = new Set([
  'passwordHash',
  'sessionKey',
  'csrfNonce',
  'hmacSignature',
  'encryptedCode',
]);

/**
 * 递归过滤响应对象中的敏感字段
 * 用于：在响应前清洗数据库查询结果
 */
export function sanitizeResponse<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(sanitizeResponse) as unknown as T;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_FIELDS.has(key)) continue;
    result[key] = typeof value === 'object' ? sanitizeResponse(value) : value;
  }
  return result as T;
}

// ─── 审计日志辅助 ─────────────────────────────────

export type AuditAction =
  | 'admin.login'
  | 'admin.logout'
  | 'admin.create'
  | 'admin.patch'
  | 'admin.delete'
  | 'admin.change_role'
  | 'user.ban'
  | 'user.unban'
  | 'user.set_expiry'
  | 'user.patch'
  | 'user.delete'
  | 'code.upload'
  | 'code.delete'
  | 'code.activate'
  | 'config.update';

export async function writeAuditLog(params: {
  actorId: string;
  action: AuditAction | string;
  target?: string | null;
  meta?: Record<string, unknown>;
  req?: NextRequest;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        action: params.action,
        target: params.target ?? null,
        meta: {
          ...params.meta,
          ...(params.req
            ? {
                ip: getClientIpForAudit(params.req),
                ua: params.req.headers.get('user-agent')?.slice(0, 200) ?? '',
              }
            : {}),
        },
      },
    });
  } catch (e) {
    // 审计日志写入失败不应阻塞主流程，但需记录
    console.error('[audit] write failed:', e);
  }
}

function getClientIpForAudit(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim().slice(0, 50);
  return req.headers.get('x-real-ip')?.slice(0, 50) ?? '127.0.0.1';
}
