/**
 * GPS Capture & Fraud Detection Utility
 *
 * Design constraints:
 *  - GPS is OPTIONAL: captureGPS() never throws — callers must never block on null.
 *  - No schema changes: analysis result flows into metadata only.
 *  - Pure analysis: analyzeGPS() is deterministic, no side effects, no network calls.
 *  - Speed check: clock-in capture is persisted to sessionStorage so the
 *    clock-out path can compute implied speed without an extra DB query.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface GPSCapture {
  lat: number;
  lon: number;
  accuracy: number;      // metres — from GeolocationCoordinates.accuracy
  gpsTimestamp: number;  // epoch ms from the GPS device clock (pos.timestamp)
  capturedAt: number;    // epoch ms from Date.now() at the moment of capture
}

export type GPSFlag =
  | 'LOW_ACCURACY'      // accuracy > 200 m (coarse cell / Wi-Fi fix)
  | 'FAR_FROM_SITE'     // >500 m from known venue coordinates
  | 'IMPOSSIBLE_SPEED'  // implied travel speed vs clock-in > 150 km/h
  | 'TIME_MISMATCH';    // GPS clock diverges from device clock by > 5 min

export type GPSConfidence = 'high' | 'medium' | 'low';

export interface GPSAnalysis {
  hasLocation: boolean;
  accuracy: number | null;
  distanceFromSite: number | null; // metres, null when venue coords unavailable
  confidence: GPSConfidence;
  flags: GPSFlag[];
}

// ── Thresholds (all constants — easy to tune) ─────────────────────────────────

const ACCURACY_THRESHOLD_M  = 200;         // coarse fix warning
const FAR_THRESHOLD_M       = 500;         // outside venue perimeter
const IMPOSSIBLE_SPEED_KMH  = 150;         // physically impossible travel speed
const TIME_MISMATCH_MS      = 5 * 60_000;  // GPS clock vs device clock tolerance

// ── Haversine distance ────────────────────────────────────────────────────────

export function haversineMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── GPS capture ───────────────────────────────────────────────────────────────

/**
 * Attempt GPS capture.  Returns null on ANY failure — permission denied, signal
 * loss, timeout, unsupported device.  Callers MUST NOT gate business actions on
 * this returning a non-null value.
 */
export async function captureGPS(): Promise<GPSCapture | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;

  return new Promise<GPSCapture | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat:          pos.coords.latitude,
          lon:          pos.coords.longitude,
          accuracy:     pos.coords.accuracy,
          gpsTimestamp: pos.timestamp,
          capturedAt:   Date.now(),
        });
      },
      () => resolve(null),  // any error → soft null, never reject
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  });
}

// ── Session storage (speed-check bridge) ─────────────────────────────────────
// The clock-out path needs the clock-in GPS capture to compute implied speed.
// sessionStorage is per-tab and cleared on browser close — no PII leakage.

const clockInKey = (shiftId: string) => `gps_ci_${shiftId}`;

export function storeClockInCapture(shiftId: string, capture: GPSCapture): void {
  try {
    sessionStorage.setItem(clockInKey(shiftId), JSON.stringify(capture));
  } catch { /* storage unavailable — skip silently */ }
}

export function retrieveClockInCapture(shiftId: string): GPSCapture | null {
  try {
    const raw = sessionStorage.getItem(clockInKey(shiftId));
    return raw ? (JSON.parse(raw) as GPSCapture) : null;
  } catch {
    return null;
  }
}

export function clearClockInCapture(shiftId: string): void {
  try { sessionStorage.removeItem(clockInKey(shiftId)); } catch { /* ok */ }
}

// ── Fraud analysis ────────────────────────────────────────────────────────────

/**
 * Pure, synchronous, deterministic fraud analysis.
 * No network, no side effects — safe to call in render.
 *
 * @param capture       Result of captureGPS() for this action
 * @param venueLat      Venue latitude from organizations.venue_lat (may be null)
 * @param venueLon      Venue longitude from organizations.venue_lon (may be null)
 * @param prevCapture   Clock-in capture for speed check at clock-out (optional)
 */
export function analyzeGPS(
  capture: GPSCapture | null,
  venueLat: number | null,
  venueLon: number | null,
  prevCapture?: GPSCapture | null,
): GPSAnalysis {
  if (!capture) {
    return {
      hasLocation:      false,
      accuracy:         null,
      distanceFromSite: null,
      confidence:       'low',
      flags:            ['LOW_ACCURACY'],
    };
  }

  const flags: GPSFlag[] = [];

  // 1. Accuracy check — low-quality fix (cell tower, coarse Wi-Fi)
  if (capture.accuracy > ACCURACY_THRESHOLD_M) {
    flags.push('LOW_ACCURACY');
  }

  // 2. GPS clock vs device clock — a large drift may indicate replayed or
  //    injected position data (common with mock-location apps).
  const clockDriftMs = Math.abs(capture.capturedAt - capture.gpsTimestamp);
  if (clockDriftMs > TIME_MISMATCH_MS) {
    flags.push('TIME_MISMATCH');
  }

  // 3. Distance from venue (skipped when venue coords are not configured)
  let distanceFromSite: number | null = null;
  if (venueLat !== null && venueLon !== null) {
    distanceFromSite = haversineMeters(
      capture.lat, capture.lon, venueLat, venueLon,
    );
    if (distanceFromSite > FAR_THRESHOLD_M) {
      flags.push('FAR_FROM_SITE');
    }
  }

  // 4. Implied speed check (clock-out only)
  //    If the employee's GPS moved faster than 150 km/h between clock-in and
  //    clock-out, one of the two readings is almost certainly spoofed.
  if (prevCapture) {
    const distMeters  = haversineMeters(
      prevCapture.lat, prevCapture.lon, capture.lat, capture.lon,
    );
    const elapsedSecs = (capture.capturedAt - prevCapture.capturedAt) / 1000;
    if (elapsedSecs > 0) {
      const speedKmh = (distMeters / elapsedSecs) * 3.6;
      if (speedKmh > IMPOSSIBLE_SPEED_KMH) {
        flags.push('IMPOSSIBLE_SPEED');
      }
    }
  }

  // 5. Derive confidence label
  //    'low'    → ≥2 flags, or any impossible-speed, or far+low-accuracy together
  //    'medium' → exactly 1 flag
  //    'high'   → 0 flags
  let confidence: GPSConfidence = 'high';
  if (
    flags.length >= 2 ||
    flags.includes('IMPOSSIBLE_SPEED') ||
    (flags.includes('FAR_FROM_SITE') && flags.includes('LOW_ACCURACY'))
  ) {
    confidence = 'low';
  } else if (flags.length === 1) {
    confidence = 'medium';
  }

  return {
    hasLocation: true,
    accuracy:    capture.accuracy,
    distanceFromSite,
    confidence,
    flags,
  };
}

// ── Formatting helpers (UI) ───────────────────────────────────────────────────

export function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}

export function confidenceColor(confidence: GPSConfidence): string {
  switch (confidence) {
    case 'high':   return 'text-emerald-500';
    case 'medium': return 'text-amber-500';
    case 'low':    return 'text-red-500';
  }
}

export function flagLabel(flag: GPSFlag): string {
  switch (flag) {
    case 'LOW_ACCURACY':     return 'Low accuracy fix';
    case 'FAR_FROM_SITE':    return 'Far from venue';
    case 'IMPOSSIBLE_SPEED': return 'Impossible travel speed';
    case 'TIME_MISMATCH':    return 'GPS clock mismatch';
  }
}
