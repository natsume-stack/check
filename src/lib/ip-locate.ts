/**
 * 多源 IP 地理定位 — 联合 3 个免费端点加权平均
 *
 * 数据源：
 *   1. ip-api.com        — 免费 45 req/min，无 token，返回精度高
 *   2. ipinfo.io         — 免费 50k/月，需 token 提升精度
 *   3. ipapi.co          — 免费 30k/月，无需 token
 *
 * 策略：
 *   - 并发请求 3 个数据源
 *   - 任意一个失败不影响其他
 *   - 至少 1 个成功即返回
 *   - 多源结果加权平均（按各源置信度权重）
 *   - accuracyKm 字段表示定位精度半径
 */

export interface GeoLocation {
  country: string;
  region: string;
  city: string;
  latitude: number;
  longitude: number;
  accuracyKm: number;
  asn?: string;
  org?: string;
  timezone?: string;
  sources: string[]; // 标识哪些数据源贡献了结果
}

interface SourceResult {
  source: string;
  weight: number;   // 置信度权重
  lat: number;
  lon: number;
  country?: string;
  region?: string;
  city?: string;
  accuracyKm?: number;
  asn?: string;
  org?: string;
  timezone?: string;
}

const SOURCES = {
  ipApi: 'ip-api',
  ipinfo: 'ipinfo',
  ipapiCo: 'ipapi-co',
} as const;

async function fetchIpApiCom(ip: string): Promise<SourceResult | null> {
  try {
    const resp = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,regionName,city,lat,lon,timezone,as,org,asname`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.status !== 'success') return null;
    return {
      source: SOURCES.ipApi,
      weight: 1.0,
      lat: data.lat,
      lon: data.lon,
      country: data.country,
      region: data.regionName,
      city: data.city,
      timezone: data.timezone,
      asn: data.as,
      org: data.org,
      accuracyKm: 50,
    };
  } catch {
    return null;
  }
}

async function fetchIpinfo(ip: string): Promise<SourceResult | null> {
  try {
    const token = process.env.IPINFO_TOKEN;
    const url = token
      ? `https://ipinfo.io/${ip}/json?token=${token}`
      : `https://ipinfo.io/${ip}/json`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.loc) return null;
    const [lat, lon] = String(data.loc).split(',').map(Number);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
    return {
      source: SOURCES.ipinfo,
      weight: 0.9,
      lat,
      lon,
      country: data.country,
      region: data.region,
      city: data.city,
      timezone: data.timezone,
      org: data.org,
      accuracyKm: data.radius ? Number(data.radius) : 30,
    };
  } catch {
    return null;
  }
}

async function fetchIpapiCo(ip: string): Promise<SourceResult | null> {
  try {
    const key = process.env.IPAPI_KEY;
    const url = key
      ? `https://ipapi.co/${ip}/json/?key=${key}`
      : `https://ipapi.co/${ip}/json/`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.error) return null;
    if (typeof data.latitude !== 'number') return null;
    return {
      source: SOURCES.ipapiCo,
      weight: 0.8,
      lat: data.latitude,
      lon: data.longitude,
      country: data.country_name,
      region: data.region,
      city: data.city,
      timezone: data.timezone,
      asn: data.asn,
      org: data.org,
      accuracyKm: 40,
    };
  } catch {
    return null;
  }
}

/** 加权平均多个数据源的经纬度 */
function weightedAverage(results: SourceResult[]): {
  lat: number;
  lon: number;
  accuracyKm: number;
} {
  const totalWeight = results.reduce((s, r) => s + r.weight, 0);
  const lat =
    results.reduce((s, r) => s + r.lat * r.weight, 0) / totalWeight;
  const lon =
    results.reduce((s, r) => s + r.lon * r.weight, 0) / totalWeight;

  // 多源一致时精度提升；分歧时取最差精度的 0.6 倍（保守估计）
  if (results.length === 1) {
    return { lat, lon, accuracyKm: results[0].accuracyKm ?? 50 };
  }
  const maxDist = Math.max(
    ...results.map(r => haversine(lat, lon, r.lat, r.lon))
  );
  return {
    lat,
    lon,
    accuracyKm: Math.min(100, Math.max(5, maxDist / 2)),
  };
}

function haversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** 选非空字段时优先权重高的数据源 */
function pickField<T>(
  results: SourceResult[],
  getter: (r: SourceResult) => T | undefined
): T | undefined {
  for (const r of [...results].sort((a, b) => b.weight - a.weight)) {
    const v = getter(r);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/**
 * 联合定位入口
 * @param ip 客户端 IP
 * @returns GeoLocation 或 null（所有源都失败时）
 */
export async function locateIp(ip: string): Promise<GeoLocation | null> {
  // 本地地址直接返回 null
  if (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('172.16.')
  ) {
    return null;
  }

  const [r1, r2, r3] = await Promise.allSettled([
    fetchIpApiCom(ip),
    fetchIpinfo(ip),
    fetchIpapiCo(ip),
  ]);

  const results: SourceResult[] = [];
  for (const r of [r1, r2, r3]) {
    if (r.status === 'fulfilled' && r.value) results.push(r.value);
  }

  if (results.length === 0) return null;

  const { lat, lon, accuracyKm } = weightedAverage(results);

  return {
    latitude: lat,
    longitude: lon,
    accuracyKm,
    country: pickField(results, r => r.country) ?? 'Unknown',
    region: pickField(results, r => r.region) ?? '',
    city: pickField(results, r => r.city) ?? '',
    asn: pickField(results, r => r.asn),
    org: pickField(results, r => r.org),
    timezone: pickField(results, r => r.timezone),
    sources: results.map(r => r.source),
  };
}
