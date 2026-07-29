/**
 * GET /session — LokiBox 客户端握手
 *
 * 客户端用 BootstrapKey 加密（无 payload），服务端：
 *   1. 如果请求携带有效 JWT（已登录用户），返回 JWT 中绑定的 session
 *      （避免页面刷新后创建新 session 导致 sid 不匹配）
 *   2. 否则创建新 Session，生成 32 字节随机 sessionKey
 *   3. 返回 { id, key }，用 BootstrapKey 或 sessionKey 加密
 *
 * 安全：
 *   - IP 维度限流：60s 内最多 30 次握手（防 DoS 刷 session）
 *   - 时间戳防重放窗口 ±60s
 *   - Session 24h 过期，吊销后不可用
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail, generateSessionKey, verifyJwt } from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
  getClientIp,
} from '@/lib/request';
import { checkRateLimit } from '@/lib/security';

export async function GET(req: NextRequest) {
  // IP 维度限流（防 DoS 刷 session 表）
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, { key: 'session-handshake', windowMs: 60_000, max: 30 });
  if (!rl.ok) {
    return encryptedJsonResponse(
      fail('RATE_LIMITED', 'Too many handshake requests'),
      req
    );
  }

  const parsed = await parseEncryptedRequest(req);

  if (!parsed.replayValid) {
    return encryptedJsonResponse(
      fail('VALIDATION_ERROR', 'Invalid or expired timestamp'),
      req
    );
  }

  // ── 已登录用户：返回 JWT 中绑定的 session ──
  // 页面刷新时客户端会调用 getSession()，此时用户已登录（有 JWT），
  // 必须返回与 JWT sid 一致的 session，否则后续所有 API 都会因 sid 不匹配而 401
  const authHeader = req.headers.get('Authorization') ?? '';
  if (authHeader.startsWith('Bearer ')) {
    const claims = await verifyJwt(authHeader.slice(7));
    if (claims?.type === 'loki' && claims.sid) {
      const existing = await prisma.session.findUnique({
        where: { id: claims.sid },
        select: { id: true, sessionKey: true, expiresAt: true, revokedAt: true },
      }).catch(() => null);

      if (existing && !existing.revokedAt && existing.expiresAt > new Date()) {
        return encryptedJsonResponse(
          ok({
            id: existing.id,
            key: existing.sessionKey,
          }),
          req
        );
      }
    }
  }

  // ── 未登录用户：创建新 session ──
  const sessionKey = generateSessionKey();
  const session = await prisma.session.create({
    data: {
      sessionKey,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
    },
  });

  return encryptedJsonResponse(
    ok({
      id: session.id,
      key: sessionKey,
    }),
    req
  );
}

// 兼容 LokiBox 的 GET 调用方式
export const dynamic = 'force-dynamic';
