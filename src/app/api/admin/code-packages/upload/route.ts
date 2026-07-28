/**
 * POST /api/admin/code-packages/upload — 上传代码包
 *
 * 请求体：{ featureId, version, code }
 *  - 计算 codeHash（SHA-256 hex）
 *  - AES-256-GCM 加密后入库（数据库不存明文）
 *  - 将同 featureId 的旧版本设为 isActive=false
 *  - 创建新 CodePackage（isActive=true）
 *  - 创建 AuditLog
 */

import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';
import { encryptCodeAtRest } from '@/lib/crypto';

interface UploadBody {
  featureId?: string;
  version?: string;
  code?: string;
}

export async function POST(req: NextRequest) {
  const claims = await requireSuperAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = (await req.json()) as UploadBody;
  const featureId = body.featureId?.trim();
  const version = body.version?.trim();
  const code = body.code ?? '';

  if (!featureId) return jsonResponse({ error: 'Missing featureId' }, 400);
  if (!version) return jsonResponse({ error: 'Missing version' }, 400);
  if (!code) return jsonResponse({ error: 'Missing code' }, 400);

  // 计算代码包哈希（SHA-256 hex）和大小
  const codeHash = createHash('sha256').update(code, 'utf8').digest('hex');
  const sizeBytes = Buffer.byteLength(code, 'utf-8');

  // AES-256-GCM 加密后入库
  const encryptedCode = encryptCodeAtRest(code);

  // 将同 featureId 的旧版本设为 inactive
  await prisma.codePackage.updateMany({
    where: { featureId, isActive: true },
    data: { isActive: false },
  });

  // 创建新代码包
  const pkg = await prisma.codePackage.create({
    data: {
      featureId,
      version,
      encryptedCode,
      codeHash,
      hmacSignature: '', // 已废弃，保留字段兼容旧数据
      sizeBytes,
      isActive: true,
    },
  });

  // 审计日志
  await prisma.auditLog.create({
    data: {
      actorId: claims.sub,
      action: 'code.upload',
      target: featureId,
      meta: { version, codeHash, sizeBytes },
    },
  });

  return jsonResponse({
    id: pkg.id,
    featureId: pkg.featureId,
    version: pkg.version,
    codeHash: pkg.codeHash,
    sizeBytes: pkg.sizeBytes,
  });
}

export const dynamic = 'force-dynamic';
