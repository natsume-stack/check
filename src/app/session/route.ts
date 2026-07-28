/**
 * POST /session — LokiBox 客户端握手
 *
 * 客户端用 BootstrapKey 加密（无 payload），服务端：
 *   1. 创建 Session 记录，生成 32 字节随机 sessionKey
 *   2. 返回 { id, key }，用 BootstrapKey 加密
 *   3. 后续请求双方都用 sessionKey
 *
 * 安全：
 *   - IP 维度限流：60s 内最多 30 次握手（防 DoS 刷 session）
 *   - 时间戳防重放窗口 ±60s
 *   - Session 24h 过期，吊销后不可用
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail, generateSessionKey } from '@/lib/crypto';
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

  // 创建新 session
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
