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

const BOOTSTRAP_KEY_B64 =
  process.env.BOOTSTRAP_KEY_B64 ??
  '105DTeoxSkrA76RQSMtyP56CXlzraLK41A1avgw+FnY=';

function bsKeyBytes(): Buffer {
  return Buffer.from(BOOTSTRAP_KEY_B64, 'base64');
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

// ─── HMAC 防重放 ───────────────────────────────────

const REPLAY_WINDOW_MS = 60_000; // ±60s

export function verifyTimestamp(timestamp: number): boolean {
  const now = Date.now();
  return Math.abs(now - timestamp) <= REPLAY_WINDOW_MS;
}

export function hmacSign(message: string): string {
  const secret = process.env.HMAC_SECRET ?? 'default-hmac-secret-change-me';
  return crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('base64');
}

export function hmacVerify(message: string, signature: string): boolean {
  const expected = hmacSign(message);
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'base64'),
    Buffer.from(signature, 'base64')
  );
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

export interface JwtClaims {
  sub: string;   // user id
  username: string;
  role: Role;
}

export async function signJwt(claims: JwtClaims): Promise<string> {
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
    return {
      sub: payload.sub as string,
      username: payload.username as string,
      role: payload.role as Role,
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
