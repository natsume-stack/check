/**
 * 加密 lib — 与 LokiBox 客户端 [src/api/security.ts] 完全对称
 *
 * 全链路安全设计：
 *   1. BootstrapKey（PSK）仅在首次握手使用，握手后下发 sessionKey 替换
 *   2. AES-256-GCM 加密 payload，每次随机 12 字节 IV
 *   3. HMAC-SHA256 防篡改 + 时间戳防重放窗口 ±60s
 *   4. JWT 签发管理会话（HttpOnly Cookie）
 *   5. bcrypt 哈希用户密码（cost=12）
 *   6. 设备指纹绑定（登录时记录，跨设备登录触发风控）
 */

import crypto from 'node:crypto';

// ─── BootstrapKey（与客户端硬编码一致）──────────────

function bsKeyBytes(): Buffer {
  const key = process.env.BOOTSTRAP_KEY_B64;
  if (!key) {
    throw new Error('BOOTSTRAP_KEY_B64 environment variable is not set');
  }
  return Buffer.from(key, 'base64');
}

/** 服务端导出 BootstrapKey 为 Web Crypto CryptoKey（用于加解密 */
export async function getBootstrapKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    bsKeyBytes(),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

// ─── sessionKey 管理 ───────────────────────────────

/** 生成 32 字节随机 sessionKey，返回 base64 */
export function generateSessionKey(): string {
  return crypto.randomBytes(32).toString('base64');
}

/** 把 base64 sessionKey 转成 Web Crypto CryptoKey */
export async function importSessionKey(b64: string): Promise<CryptoKey> {
  const raw = Buffer.from(b64, 'base64');
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

// ─── AES-256-GCM 加解密 ────────────────────────────

export interface EncryptedPayload {
  iv: string;   // base64
  data: string; // base64
}

export async function encryptPayload(
  payload: unknown,
  key: CryptoKey
): Promise<EncryptedPayload> {
  const iv = crypto.randomBytes(12);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );
  return {
    iv: iv.toString('base64'),
    data: Buffer.from(cipher).toString('base64'),
  };
}

export async function decryptPayload<T = unknown>(
  payload: EncryptedPayload,
  key: CryptoKey
): Promise<T> {
  const iv = Buffer.from(payload.iv, 'base64');
  const ciphertext = Buffer.from(payload.data, 'base64');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return JSON.parse(Buffer.from(plain).toString('utf8')) as T;
}

// ─── 时间戳防重放 ───────────────────────────────────

const REPLAY_WINDOW_MS = 60_000; // ±60s

export function verifyTimestamp(timestamp: number): boolean {
  const now = Date.now();
  return Math.abs(now - timestamp) <= REPLAY_WINDOW_MS;
}

// ─── 代码包静态加密（AES-256-GCM at rest）────────────

/** 获取代码包加密密钥（32 字节，base64 编码） */
function getPackEncryptionKey(): Buffer {
  const key = process.env.PACK_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('PACK_ENCRYPTION_KEY environment variable is not set');
  }
  const buf = Buffer.from(key, 'base64');
  if (buf.length !== 32) {
    throw new Error('PACK_ENCRYPTION_KEY must be 32 bytes (base64 encoded)');
  }
  return buf;
}

/** 加密代码包，返回 JSON 字符串（含 iv + data + authTag） */
export function encryptCodeAtRest(code: string): string {
  const key = getPackEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(code, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    data: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  });
}

/** 解密代码包，返回明文 JS 源码 */
export function decryptCodeAtRest(stored: string): string {
  const key = getPackEncryptionKey();
  const parsed = JSON.parse(stored) as {
    data: string;
    iv: string;
    authTag: string;
  };
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(parsed.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(parsed.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(parsed.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

// ─── 密码哈希 ──────────────────────────────────────

import bcrypt from 'bcryptjs';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ─── JWT ───────────────────────────────────────────

import { SignJWT, jwtVerify } from 'jose';

const JWT_ALG = 'HS256';

function getJwtSecret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return new TextEncoder().encode(s);
}

export type Role = 'SUPER_ADMIN' | 'AGENT' | 'USER';

/** 后台管理员 JWT claims（登录 check 后台） */
export interface AdminJwtClaims {
  sub: string;        // AdminUser.id
  username: string;
  role: Role;
  type: 'admin';      // 区分 token 类型
}

/** LokiBox 客户端 JWT claims（加密链路登录） */
export interface LokiJwtClaims {
  sub: string;        // LokiUser.id
  username: string;
  type: 'loki';       // 区分 token 类型
  fp?: string;        // 设备指纹（绑定登录设备）
  sid?: string;       // Session ID（绑定 session，防盗用）
}

/** 兼容旧代码的联合类型 */
export type JwtClaims = AdminJwtClaims | LokiJwtClaims;

export async function signJwt(claims: AdminJwtClaims | LokiJwtClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getJwtSecret());
}

export async function verifyJwt(token: string): Promise<JwtClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      algorithms: [JWT_ALG],
    });
    const type = payload.type as 'admin' | 'loki';
    if (type === 'loki') {
      return {
        sub: payload.sub as string,
        username: payload.username as string,
        type: 'loki',
        fp: payload.fp as string | undefined,
        sid: payload.sid as string | undefined,
      };
    }
    return {
      sub: payload.sub as string,
      username: payload.username as string,
      role: payload.role as Role,
      type: 'admin',
    };
  } catch {
    return null;
  }
}

// ─── 统一响应包装（与 LokiBox schema 兼容）─────────

export interface ApiResponse<T> {
  code: 'OK' | string;
  message: string;
  data: T;
  trace_id: string;
}

export function ok<T>(data: T, message = ''): ApiResponse<T> {
  return {
    code: 'OK',
    message,
    data,
    trace_id: crypto.randomUUID(),
  };
}

export function fail(
  code: string,
  message: string,
  details: unknown = null
): ApiResponse<null> {
  return {
    code,
    message,
    data: null as unknown as null,
    trace_id: crypto.randomUUID(),
  };
}

// ─── 设备指纹 ──────────────────────────────────────

/** 服务端计算的复合指纹：UA + 平台 + 屏幕 + 时区，与客户端 getFingerprint 对齐 */
export function computeFingerprint(parts: {
  userAgent: string;
  platform: string;
  screenWidth: number;
  screenHeight: number;
  timezone: string;
}): string {
  const raw = [
    parts.userAgent,
    parts.platform,
    parts.screenWidth,
    parts.screenHeight,
    parts.timezone,
  ].join('|');
  return crypto
    .createHash('sha256')
    .update(raw)
    .digest('base64');
}
