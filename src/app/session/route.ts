/**
 * POST /session — LokiBox 客户端握手
 *
 * 客户端用 BootstrapKey 加密（无 payload），服务端：
 *   1. 创建 Session 记录，生成 32 字节随机 sessionKey
 *   2. 返回 { id, key }，用 BootstrapKey 加密
 *   3. 后续请求双方都用 sessionKey
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail, generateSessionKey } from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
} from '@/lib/request';

export async function GET(req: NextRequest) {
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
