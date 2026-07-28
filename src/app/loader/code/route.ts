/**
 * POST /loader/code — 下发加密代码包
 *
 * 请求体（加密后）：{ featureIds: string[] }
 * 响应（加密后）：ok({ packages: [{ featureId, codeHash, code, version }] })
 *
 * 说明：
 *   - CodePackage.encryptedCode 字段存储 AES-256-GCM 加密后的密文
 *   - 下发时先解密为明文 JS，再由 encryptedJsonResponse 用 sessionKey 统一加密
 *   - 过滤掉 ProgramConfig 中 disabled 的 feature
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

interface CodePayload {
  featureIds: string[];
}

// 用户状态 reason → fail code 映射
const STATUS_FAIL_CODE: Record<string, string> = {
  BANNED: 'ACCOUNT_BANNED',
  EXPIRED: 'ACCOUNT_EXPIRED',
  SUSPENDED: 'ACCOUNT_SUSPENDED',
};

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, { key: 'loader-code', windowMs: 60_000, max: 20 });
  if (!rl.ok) {
    return encryptedJsonResponse(
      fail('RATE_LIMITED', 'Too many requests'),
      req
    );
  }

  const parsed = await parseEncryptedRequest<CodePayload>(req);

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

  // 设备指纹验证
  const fpValid = await validateFingerprint(claims.sub, claims.fp);
  if (!fpValid) {
    return encryptedJsonResponse(
      fail('DEVICE_MISMATCH', 'Device fingerprint mismatch, please re-login'),
      req
    );
  }

  const payload = parsed.data;
  if (!payload || !Array.isArray(payload.featureIds) || payload.featureIds.length === 0) {
    return encryptedJsonResponse(
      fail('VALIDATION_ERROR', 'Missing or invalid featureIds'),
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

  const featureIds = payload.featureIds;

  // 查询 ProgramConfig，过滤掉 disabled 的 feature
  const configs = await prisma.programConfig.findMany({
    where: {
      programId: 'lokibox',
      featureId: { in: featureIds },
    },
    select: { featureId: true, disabled: true },
  });
  const disabledSet = new Set(
    configs.filter(c => c.disabled).map(c => c.featureId)
  );

  // 查询当前激活的代码包
  const allPackages = await prisma.codePackage.findMany({
    where: {
      featureId: { in: featureIds },
      isActive: true,
    },
    select: {
      featureId: true,
      codeHash: true,
      encryptedCode: true,
      version: true,
    },
  });

  // 过滤掉 disabled 的 feature，并解密代码包
  const packages = allPackages
    .filter(p => !disabledSet.has(p.featureId))
    .map(p => ({
      featureId: p.featureId,
      codeHash: p.codeHash,
      code: decryptCodeAtRest(p.encryptedCode),
      version: p.version,
    }));

  return encryptedJsonResponse(
    ok({ packages }),
    req
  );
}

export const dynamic = 'force-dynamic';
