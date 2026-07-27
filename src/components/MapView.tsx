'use client';

import { Fragment } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// 修复 Leaflet 默认 marker 图标路径
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

export interface MapLocation {
  lat: number;
  lon: number;
  accuracyKm?: number;
  label?: string;
  sub?: string;
}

export default function MapView({
  locations,
  height = 360,
}: {
  locations: MapLocation[];
  height?: number;
}) {
  if (typeof window === 'undefined') return null;

  if (locations.length === 0) {
    return (
      <div
        className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] text-sm"
        style={{ height }}
      >
        暂无位置数据
      </div>
    );
  }

  // 计算合适的中心点和缩放
  const lats = locations.map(l => l.lat);
  const lons = locations.map(l => l.lon);
  const center: [number, number] = [
    lats.reduce((a, b) => a + b, 0) / lats.length,
    lons.reduce((a, b) => a + b, 0) / lons.length,
  ];

  return (
    <div
      className="rounded-2xl overflow-hidden border border-[var(--border)]"
      style={{ height }}
    >
      <MapContainer
        center={center}
        zoom={locations.length === 1 ? 10 : 4}
        style={{ height: '100%', width: '100%', background: '#1a1a1a' }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {locations.map((loc, i) => (
          <Fragment key={i}>
            <Marker position={[loc.lat, loc.lon]}>
              <Popup>
                <div className="text-sm">
                  <div className="font-bold">{loc.label ?? 'User'}</div>
                  {loc.sub && <div className="text-xs">{loc.sub}</div>}
                  <div className="text-xs mt-1 font-mono">
                    {loc.lat.toFixed(4)}, {loc.lon.toFixed(4)}
                  </div>
                  {loc.accuracyKm && (
                    <div className="text-xs text-gray-500">
                      精度 ±{loc.accuracyKm.toFixed(1)} km
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
            {loc.accuracyKm && loc.accuracyKm > 0 && (
              <Circle
                center={[loc.lat, loc.lon]}
                radius={loc.accuracyKm * 1000}
                pathOptions={{
                  color: '#171717',
                  fillColor: '#171717',
                  fillOpacity: 0.08,
                  weight: 1,
                }}
              />
            )}
          </Fragment>
        ))}
      </MapContainer>
    </div>
  );
}
