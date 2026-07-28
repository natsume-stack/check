/**
 * POST /loader/code — 下发加密代码包
 *
 * 请求体（加密后）：{ featureIds: string[] }
 * 响应（加密后）：ok({ packages: [{ featureId, codeHash, encryptedCode, version }] })
 *
 * 说明：
 *   - CodePackage.encryptedCode 字段实际存储明文 JS 源码
 *   - 整个响应由 encryptedJsonResponse 用 sessionKey 统一加密
 *   - 过滤掉 ProgramConfig 中 disabled 的 feature
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
} from '@/lib/request';
import { getLokiBoxUser, checkUserStatus } from '@/lib/auth';

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

  // 过滤掉 disabled 的 feature
  const packages = allPackages.filter(p => !disabledSet.has(p.featureId));

  return encryptedJsonResponse(
    ok({
      packages: packages.map(p => ({
        featureId: p.featureId,
        codeHash: p.codeHash,
        encryptedCode: p.encryptedCode,
        version: p.version,
      })),
    }),
    req
  );
}

export const dynamic = 'force-dynamic';
