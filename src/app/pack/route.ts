/**
 * GET /pack — 下发完整代码包给加载器
 *
 * 加密链路：Bearer token 鉴权 + sessionKey 加密响应
 * 响应：ok({ code: string, hash: string, version: string })
 *
 * 代码包在数据库中 AES-256-GCM 加密存储，下发时解密为明文 JS，
 * 再由 encryptedJsonResponse 用 sessionKey 加密传输。
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail, decryptCodeAtRest } from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
  getClientIp,
} from '@/lib/request';
import { checkRateLimit } from '@/lib/security';
import { getLokiBoxUser, checkUserStatus, validateFingerprint } from '@/lib/auth';

const STATUS_FAIL_CODE: Record<string, string> = {
  BANNED: 'ACCOUNT_BANNED',
  EXPIRED: 'ACCOUNT_EXPIRED',
  SUSPENDED: 'ACCOUNT_SUSPENDED',
};

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, { key: 'pack-fetch', windowMs: 60_000, max: 20 });
  if (!rl.ok) {
    return encryptedJsonResponse(
      fail('RATE_LIMITED', 'Too many requests'),
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

  const claims = await getLokiBoxUser(req);
  if (!claims) {
    return encryptedJsonResponse(
      fail('UNAUTHORIZED', 'Not authenticated'),
      req
    );
  }

  // 设备指纹验证 — 防止被盗 JWT 在不同设备上拉取代码包
  const fpValid = await validateFingerprint(claims.sub, claims.fp);
  if (!fpValid) {
    return encryptedJsonResponse(
      fail('DEVICE_MISMATCH', 'Device fingerprint mismatch, please re-login'),
      req
    );
  }

  // 检查账号状态
  const statusCheck = await checkUserStatus(claims.sub);
  if (!statusCheck.ok) {
    return encryptedJsonResponse(
      fail(
        STATUS_FAIL_CODE[statusCheck.reason] ?? 'ACCOUNT_BANNED',
        statusCheck.message
      ),
      req
    );
  }

  // 查询激活的代码包
  const pack = await prisma.codePackage.findFirst({
    where: {
      featureId: 'lokibox-pack',
      isActive: true,
    },
    select: {
      encryptedCode: true,
      codeHash: true,
      version: true,
    },
  });

  if (!pack) {
    return encryptedJsonResponse(
      fail('PACK_NOT_FOUND', 'Code package not uploaded yet'),
      req
    );
  }

  // 解密代码包（数据库中 AES-256-GCM 加密存储）
  let code: string;
  try {
    code = decryptCodeAtRest(pack.encryptedCode);
  } catch {
    return encryptedJsonResponse(
      fail('PACK_DECRYPT_ERROR', 'Failed to decrypt code package'),
      req
    );
  }

  // 更新 session 的 codeHash（用于心跳完整性校验）
  const sessionId = req.headers.get('X-Session-Id');
  if (sessionId) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { codeHash: pack.codeHash },
    });
  }

  return encryptedJsonResponse(
    ok({
      code,
      hash: pack.codeHash,
      version: pack.version,
    }),
    req
  );
}

export const dynamic = 'force-dynamic';
