import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_AUSTIN_ROWS_URL,
  DEFAULT_AUSTIN_MAX_SOURCES,
  AUSTIN_DOWNTOWN,
  CALTRANS_CCTV_URL,
  DEFAULT_CALTRANS_DISTRICTS,
  DEFAULT_CALTRANS_MAX_SOURCES,
  CALTRANS_ANCHORS,
  TFL_JAMCAM_URL,
  TFL_IMAGE_ORIGIN,
  DEFAULT_TFL_MAX_SOURCES,
  LONDON_CENTER,
  ONTARIO_511_CAMERAS_URL,
  ONTARIO_511_IMAGE_ORIGIN,
  DEFAULT_ONTARIO_MAX_SOURCES,
  ONTARIO_ANCHORS,
  FINTRAFFIC_STATIONS_URL,
  FINTRAFFIC_IMAGE_ORIGIN,
  FINTRAFFIC_GROUND_ELEVATION_M,
  DIGITRAFFIC_USER,
  DEFAULT_FINTRAFFIC_MAX_SOURCES,
  FINLAND_ANCHORS,
  DRIVEBC_WEBCAMS_URL,
  DRIVEBC_IMAGE_URL,
  DEFAULT_DRIVEBC_MAX_SOURCES,
  DRIVEBC_ANCHORS,
  TXDOT_CCTV_STATUS_URL,
  TXDOT_CCTV_SNAPSHOT_URL,
  TXDOT_DISTRICTS,
  DEFAULT_TXDOT_DISTRICTS,
  DEFAULT_TXDOT_MAX_SOURCES,
  TXDOT_ANCHORS,
  TXDOT_DISTRICT_ELEVATION_M,
  TXDOT_DEFAULT_ELEVATION_M,
  DEFAULT_TALLINN_SOURCE_FILE,
  DEFAULT_TALLINN_MAX_SOURCES,
  TALLINN_IMAGE_ORIGIN,
  TALLINN_CENTER,
  TARKTEE_LOCATIONS_URL,
  TARKTEE_IMAGES_URL,
  TARKTEE_IMAGE_ORIGIN,
  DEFAULT_TARKTEE_MAX_SOURCES,
  TARKTEE_ANCHORS,
  DEFAULT_WARENDORF_SOURCE_FILE,
  WARENDORF_IMAGE_ORIGINS,
  NSW_CAMERAS_URL,
  NSW_IMAGE_ORIGIN,
  DEFAULT_NSW_MAX_SOURCES,
  SYDNEY_CENTER,
  NSW_MAX_VIEW_LABEL,
  DEFAULT_CALGARY_ROWS_URL,
  CALGARY_IMAGE_ORIGIN,
  DEFAULT_CALGARY_MAX_SOURCES,
  CALGARY_DOWNTOWN,
  CALGARY_MAX_CATALOG_BYTES,
  CCTV_SOURCE_FETCH_TIMEOUT_MS,
  DELDOT_CCTV_URL,
  DEFAULT_DELDOT_MAX_SOURCES,
  DELDOT_ANCHORS,
  HK_TD_CAMERAS_URL,
  HK_TD_IMAGE_ORIGIN,
  DEFAULT_HK_TD_MAX_SOURCES,
  HK_TD_ANCHORS,
  HK_TD_MAX_CATALOG_BYTES,
  DGT_CAMERAS_URL,
  DGT_IMAGE_ORIGIN,
  DEFAULT_DGT_MAX_SOURCES,
  DGT_ANCHORS,
  DGT_MAX_CATALOG_BYTES,
  NZTA_CAMERAS_URL,
  NZTA_IMAGE_ORIGIN,
  DEFAULT_NZTA_MAX_SOURCES,
  NZTA_ANCHORS,
  NZTA_MAX_CATALOG_BYTES,
  HCMC_SESSION_URL,
  HCMC_CAMERA_QUERY_URL,
  HCMC_FRAME_URL_PREFIX,
  HCMC_CAMERA_QUERY,
  DEFAULT_HCMC_MAX_SOURCES,
  HCMC_ANCHORS,
  HCMC_MAX_CATALOG_BYTES,
} from './constants.js';
import {
  toFiniteNumber,
  extractAustinCoords,
  extractAustinCameraId,
  extractAustinName,
  extractAustinHeading,
  isLikelyAustinCoordinate,
  fallbackHeadingFromId,
  isLikelyFinlandCoordinate,
  fintrafficCameraName,
  hashSeed,
  isPlausibleLatLon,
  isLikelyBcCoordinate,
  isLikelyTexasCoordinate,
  isLikelyNswCoordinate,
  isLikelyCalgaryCoordinate,
  cameraDisplayCode,
  rowArrayToObject,
  prioritizeSources,
} from './normalize.js';
import { directionToHeading } from '../../../src/data/directionText.js';
import {
  readResponseJsonCapped,
  readCappedResponseText,
} from '../common/http.js';
/**
 * Fetch and parse Austin traffic camera records from the city Open Data portal.
 *
 * Downloads the Socrata rows.json payload, converts each row to a keyed
 * record, extracts camera ID / coords / heading / name, validates against
 * the Austin bounding box, deduplicates by ID, then distance-prioritizes
 * to stay within CCTV_AUSTIN_MAX_SOURCES.
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadAustinSourcesFromOpenData() {
  const endpoint = process.env.CCTV_AUSTIN_ROWS_URL || DEFAULT_AUSTIN_ROWS_URL;
  try {
    const resp = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn('[CCTV] Austin source download failed:', resp.status);
      return [];
    }
    const payload = await resp.json();
    const columns = Array.isArray(payload?.meta?.view?.columns)
      ? payload.meta.view.columns
      : [];
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    if (!columns.length || !rows.length) return [];

    const cameras = [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const record = rowArrayToObject(row, columns);
      const cameraId = extractAustinCameraId(record);
      if (!cameraId) continue;

      // Only live cameras: the dataset carries DESIRED (planned, not built),
      // REMOVED and VOID rows whose frame URLs never resolve — those cameras
      // would render as permanent Street View / synthetic fallbacks. Tolerate
      // a missing column (keep the row) so a schema change fails open.
      const status = String(record.camera_status || '')
        .trim()
        .toUpperCase();
      if (status && status !== 'TURNED_ON') continue;

      const { lat, lon } = extractAustinCoords(record);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (!isLikelyAustinCoordinate(lat, lon)) continue;

      const extractedHeading = extractAustinHeading(record);
      const hasHeading = Number.isFinite(extractedHeading);
      const headingDeg = hasHeading
        ? extractedHeading
        : fallbackHeadingFromId(cameraId);
      cameras.push({
        id: cameraId,
        name: extractAustinName(record, cameraId),
        city: 'Austin',
        cityId: 'austin',
        provider: 'Austin Transportation & Public Works',
        lat,
        lon,
        headingDeg,
        headingConfidence: hasHeading ? 'high' : 'low',
        pitchDeg: hasHeading ? -24 : -18,
        fovDeg: hasHeading ? 56 : 44,
        rangeM: hasHeading ? 210 : 145,
        mountHeightM: hasHeading ? 10 : 8,
        groundElevationM: 150,
        feedType: 'image',
        url: `https://cctv.austinmobility.io/image/${encodeURIComponent(cameraId)}.jpg`,
        snapshotUrl: `https://cctv.austinmobility.io/image/${encodeURIComponent(cameraId)}.jpg`,
        sourceKind: 'austin-open-data',
        license: 'Public city traffic camera frame',
      });
    }

    const unique = Array.from(
      new Map(cameras.map((camera) => [camera.id, camera])).values(),
    );
    const maxRaw = Number(
      process.env.CCTV_AUSTIN_MAX_SOURCES || DEFAULT_AUSTIN_MAX_SOURCES,
    );
    const maxCount = Number.isFinite(maxRaw)
      ? Math.max(8, Math.min(300, Math.floor(maxRaw)))
      : DEFAULT_AUSTIN_MAX_SOURCES;
    const prioritized = prioritizeSources(unique, maxCount, [AUSTIN_DOWNTOWN]);
    if (prioritized.length < unique.length) {
      console.log(
        `[CCTV] Loaded Austin camera sources: ${unique.length} (using nearest ${prioritized.length})`,
      );
    } else {
      console.log('[CCTV] Loaded Austin camera sources:', prioritized.length);
    }
    return prioritized;
  } catch (error) {
    console.warn(
      '[CCTV] Austin source download error:',
      error?.message || error,
    );
    return [];
  }
}

/**
 * Fetch Caltrans CCTV cameras for the configured districts (CCTV_CALTRANS_DISTRICTS,
 * comma-separated 1..12; empty string disables the pack). One official JSON feed per
 * district, identical schema statewide; keyless. Only inService cameras with finite
 * coords and a cwwp2.dot.ca.gov https image URL are kept (the image-URL origin check
 * is defense-in-depth: the proxy only ever fetches catalog URLs, and this pins the
 * catalog to the official host). Districts fetch in parallel and fail independently
 * (Promise.allSettled) — one district outage never darkens the others.
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadCaltransSourcesFromOpenData() {
  const districtsRaw =
    process.env.CCTV_CALTRANS_DISTRICTS ?? DEFAULT_CALTRANS_DISTRICTS;
  const districts = String(districtsRaw)
    .split(',')
    .map((token) => Number(token.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
  if (!districts.length) return [];

  const settled = await Promise.allSettled(
    districts.map(async (district) => {
      const resp = await fetch(CALTRANS_CCTV_URL(district), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
      });
      if (!resp.ok) throw new Error(`D${district} HTTP ${resp.status}`);
      const payload = await resp.json();
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      return { district, rows };
    }),
  );

  const cameras = [];
  for (const result of settled) {
    if (result.status !== 'fulfilled') {
      console.warn(
        '[CCTV] Caltrans district fetch failed:',
        result.reason?.message || result.reason,
      );
      continue;
    }
    const { district, rows } = result.value;
    for (const row of rows) {
      const cctv = row?.cctv;
      if (!cctv || String(cctv.inService).toLowerCase() !== 'true') continue;
      const loc = cctv.location || {};
      const lat = toFiniteNumber(loc.latitude);
      const lon = toFiniteNumber(loc.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const imageUrl = String(cctv.imageData?.static?.currentImageURL || '');
      // Official-host pin (see JSDoc). Also drops records with no still image.
      if (!imageUrl.startsWith('https://cwwp2.dot.ca.gov/')) continue;

      const locationName = String(loc.locationName || '').trim();
      // Leading token of locationName is the stable camera code ("TV102 -- I-580 : …").
      const codeMatch = /^([A-Za-z0-9_-]+)\s*--/.exec(locationName);
      const code = (
        codeMatch ? codeMatch[1] : `x${cameras.length}`
      ).toLowerCase();
      const cameraId = `ca-d${district}-${code}`;

      // loc.direction is a dedicated field ("West", "South") → allow bare words.
      const heading = directionToHeading(loc.direction, true);
      const hasHeading = Number.isFinite(heading);
      const label =
        locationName.replace(/^([A-Za-z0-9_-]+)\s*--\s*/, '') ||
        `Caltrans D${district} ${code}`;
      cameras.push({
        id: cameraId,
        name: loc.nearbyPlace ? `${label} (${loc.nearbyPlace})` : label,
        city: String(loc.nearbyPlace || `Caltrans D${district}`),
        cityId: `ca-d${district}`,
        provider: 'Caltrans',
        lat,
        lon,
        headingDeg: hasHeading ? heading : fallbackHeadingFromId(cameraId),
        headingConfidence: hasHeading ? 'high' : 'low',
        // Same two fabricated pose personalities as Austin (design §1a): these are
        // RAW PRIOR starting points; the client's one-shot ground snap + manual
        // calibration own the truth.
        pitchDeg: hasHeading ? -24 : -18,
        fovDeg: hasHeading ? 56 : 44,
        rangeM: hasHeading ? 210 : 145,
        mountHeightM: hasHeading ? 10 : 8,
        // loc.elevation is reported in FEET (verified: D3 maxes at 7427 ft ≈
        // 2264 m for the Sierra passes — as metres that would top Mt Whitney).
        // Convert to metres and clamp to a sane CA-roads range so an occasional
        // garbage upstream value can't fling a camera kilometres up. Prior only:
        // the client one-shot snap corrects it on 3D-tile stacks — but on a
        // no-tileset stack (keyless OSM) the snap misses and this height freezes,
        // so it must be right-ish on its own.
        groundElevationM: (() => {
          const ft = toFiniteNumber(loc.elevation, NaN);
          return Number.isFinite(ft)
            ? Math.max(-100, Math.min(4000, ft * 0.3048))
            : 150;
        })(),
        feedType: 'image',
        url: imageUrl,
        snapshotUrl: imageUrl,
        sourceKind: 'caltrans-open-data',
        license: 'Public Caltrans highway camera frame',
      });
    }
  }

  const maxRaw = Number(
    process.env.CCTV_CALTRANS_MAX_SOURCES || DEFAULT_CALTRANS_MAX_SOURCES,
  );
  const maxCount = Number.isFinite(maxRaw)
    ? Math.max(8, Math.min(600, Math.floor(maxRaw)))
    : DEFAULT_CALTRANS_MAX_SOURCES;
  const prioritized = prioritizeSources(cameras, maxCount, CALTRANS_ANCHORS);
  console.log(
    `[CCTV] Loaded Caltrans camera sources: ${cameras.length} inService (using nearest ${prioritized.length})`,
  );
  return prioritized;
}

/**
 * Fetch TfL JamCams (London). Keyless: the optional TFL_APP_KEY only raises the
 * list-endpoint rate limit (frames come from TfL's public S3 bucket, which is not
 * rate-limited); the 15-min source cache keeps list hits far below anonymous
 * limits anyway. Only `available === "true"` cameras with finite coords and an
 * image URL on the official bucket are kept. Attribution: "Powered by TfL Open
 * Data" (registered in src/data/dataCredits.js).
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadTflSourcesFromOpenData() {
  try {
    const appKey = String(process.env.TFL_APP_KEY || '').trim();
    const url = appKey
      ? `${TFL_JAMCAM_URL}?app_key=${encodeURIComponent(appKey)}`
      : TFL_JAMCAM_URL;
    const resp = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn('[CCTV] TfL JamCam download failed:', resp.status);
      return [];
    }
    const places = await resp.json();
    if (!Array.isArray(places)) return [];

    const cameras = [];
    for (const place of places) {
      const props = {};
      for (const p of place?.additionalProperties || []) {
        if (p?.key) props[p.key] = p.value;
      }
      if (String(props.available).toLowerCase() !== 'true') continue;
      const lat = toFiniteNumber(place?.lat);
      const lon = toFiniteNumber(place?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const imageUrl = String(props.imageUrl || '');
      if (!imageUrl.startsWith(TFL_IMAGE_ORIGIN)) continue; // official-bucket pin

      // "JamCams_00002.00865" → "tfl-00002.00865" (provider-stable id).
      const rawId = String(place?.id || '').replace(/^JamCams_/, '');
      if (!rawId) continue;
      const cameraId = `tfl-${rawId}`;

      cameras.push({
        id: cameraId,
        name: String(place?.commonName || `JamCam ${rawId}`),
        city: 'London',
        cityId: 'london',
        provider: 'Transport for London',
        lat,
        lon,
        // No heading signal at all in JamCam data → id-hash fallback, low
        // confidence personality (same as headingless Austin cameras).
        headingDeg: fallbackHeadingFromId(cameraId),
        headingConfidence: 'low',
        pitchDeg: -18,
        fovDeg: 44,
        rangeM: 145,
        mountHeightM: 8,
        groundElevationM: 15, // Thames-basin prior; one-shot snap corrects.
        feedType: 'image', // stills-first (owner decision); props.videoUrl deliberately unused
        url: imageUrl,
        snapshotUrl: imageUrl,
        sourceKind: 'tfl-open-data',
        license: 'Powered by TfL Open Data',
      });
    }

    const maxRaw = Number(
      process.env.CCTV_TFL_MAX_SOURCES || DEFAULT_TFL_MAX_SOURCES,
    );
    const maxCount = Number.isFinite(maxRaw)
      ? Math.max(8, Math.min(600, Math.floor(maxRaw)))
      : DEFAULT_TFL_MAX_SOURCES;
    const prioritized = prioritizeSources(cameras, maxCount, [LONDON_CENTER]);
    console.log(
      `[CCTV] Loaded TfL JamCam sources: ${cameras.length} available (using nearest ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn('[CCTV] TfL JamCam download error:', error?.message || error);
    return [];
  }
}

/**
 * Bounding-box sanity check for Ontario 511 rows.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {boolean}
 */
function isLikelyOntarioCoordinate(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return lat >= 41.0 && lat <= 57.5 && lon >= -95.6 && lon <= -74.0;
}

/**
 * Pin an Ontario 511 camera view URL to the official still-image host.
 *
 * @param {string} value - Upstream view URL.
 * @returns {string} Canonical 511on.ca still URL, or '' if not accepted.
 */
function normalizeOntarioCctvUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    const match = /^\/map\/Cctv\/([^/?#]+)$/.exec(parsed.pathname);
    if (!match) return '';
    const host = parsed.hostname.toLowerCase();
    if (
      parsed.protocol !== 'https:' ||
      (host !== '511on.ca' && !host.endsWith('.traveliq.co'))
    ) {
      return '';
    }
    const viewId = decodeURIComponent(match[1]);
    if (!/^[A-Za-z0-9_.-]+$/.test(viewId)) return '';
    return `${ONTARIO_511_IMAGE_ORIGIN}${encodeURIComponent(viewId)}`;
  } catch {
    return '';
  }
}

/**
 * Select the best Ontario 511 still view for a camera.
 *
 * @param {Array<object>} views
 * @returns {{url:string,description:string}|null}
 */
function pickOntarioCctvView(views) {
  const enabled = (Array.isArray(views) ? views : [])
    .filter(
      (view) =>
        String(view?.Status || view?.status || '')
          .trim()
          .toLowerCase() === 'enabled',
    )
    .map((view) => ({
      url: normalizeOntarioCctvUrl(view?.Url || view?.url),
      description: String(view?.Description || view?.description || '').trim(),
    }))
    .filter((view) => view.url);
  if (!enabled.length) return null;
  return (
    enabled.find((view) => !/\bdown\b/i.test(view.description)) || enabled[0]
  );
}

/**
 * Fetch Ontario 511 CCTV cameras. Keyless: the catalog is exposed by the
 * public 511 API, while frame URLs are stable still-image endpoints under
 * 511on.ca/map/Cctv/. Only rows with finite Ontario coords and at least one
 * enabled official still view are kept.
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadOntarioSourcesFromOpenData() {
  try {
    const resp = await fetch(ONTARIO_511_CAMERAS_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn('[CCTV] Ontario 511 camera download failed:', resp.status);
      return [];
    }
    const rows = await resp.json();
    if (!Array.isArray(rows)) return [];

    const cameras = [];
    for (const row of rows) {
      const rawId = String(row?.Id ?? row?.id ?? '').trim();
      if (!rawId) continue;
      const lat = toFiniteNumber(row?.Latitude ?? row?.latitude);
      const lon = toFiniteNumber(row?.Longitude ?? row?.longitude);
      if (!isLikelyOntarioCoordinate(lat, lon)) continue;

      const view = pickOntarioCctvView(row?.Views || row?.views);
      if (!view) continue;

      const cameraId = `on-${rawId}`;
      const location = String(row?.Location || row?.location || '').trim();
      const roadway = String(row?.Roadway || row?.roadway || '').trim();
      const viewLabel =
        view.description && !/\bdown\b/i.test(view.description)
          ? view.description
          : '';
      const label = [
        location || roadway || `Ontario 511 Camera ${rawId}`,
        viewLabel,
      ]
        .filter(Boolean)
        .join(' - ');
      let heading = directionToHeading(row?.Direction ?? row?.direction, true);
      if (!Number.isFinite(heading)) {
        heading = directionToHeading(view.description, true);
      }
      const hasHeading = Number.isFinite(heading);

      cameras.push({
        id: cameraId,
        name: label,
        city: location || roadway || 'Ontario',
        cityId: 'ontario',
        provider: 'Ontario 511',
        lat,
        lon,
        headingDeg: hasHeading ? heading : fallbackHeadingFromId(cameraId),
        headingConfidence: hasHeading ? 'high' : 'low',
        pitchDeg: hasHeading ? -24 : -18,
        fovDeg: hasHeading ? 56 : 44,
        rangeM: hasHeading ? 210 : 145,
        mountHeightM: hasHeading ? 10 : 8,
        groundElevationM: 200,
        feedType: 'image',
        url: view.url,
        snapshotUrl: view.url,
        sourceKind: 'ontario-511-open-data',
        license: 'Open Government Licence - Ontario',
      });
    }

    const unique = Array.from(
      new Map(cameras.map((camera) => [camera.id, camera])).values(),
    );
    const maxRaw = Number(
      process.env.CCTV_ONTARIO_MAX_SOURCES || DEFAULT_ONTARIO_MAX_SOURCES,
    );
    const maxCount = Number.isFinite(maxRaw)
      ? Math.max(8, Math.min(1000, Math.floor(maxRaw)))
      : DEFAULT_ONTARIO_MAX_SOURCES;
    const prioritized = prioritizeSources(unique, maxCount, ONTARIO_ANCHORS);
    console.log(
      `[CCTV] Loaded Ontario 511 camera sources: ${unique.length} enabled (using nearest ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn(
      '[CCTV] Ontario 511 camera download error:',
      error?.message || error,
    );
    return [];
  }
}

/**
 * Fetch Fintraffic road weather cameras (all of Finland) from Digitraffic.
 * Keyless; one GeoJSON station list per refresh (~37 KB gzipped, 809 stations
 * / 2,275 presets), identifying itself with the `Digitraffic-User` header the
 * service asks for. One PRESET — one fixed view of a station — is one camera
 * here; the presets of a station share its position, and the id-hash fallback
 * heading fans their gizmos apart instead of stacking them on one bearing.
 *
 * Skips stations whose `collectionStatus` is anything but GATHERING and presets
 * with `inCollection: false`, so the mesh carries no dead cameras. Frame URLs
 * are BUILT from the official image origin and a strictly-validated preset id
 * rather than read from the payload, which pins the frame proxy to
 * weathercam.digitraffic.fi by construction; the catalog fetch refuses
 * redirects (`redirect: 'manual'`) so the list host cannot be steered either.
 *
 * No compass heading exists anywhere in this dataset: the per-preset
 * `direction` on the detail endpoint is road-register relative
 * (INCREASING_DIRECTION = "towards higher road addresses"), not a bearing, and
 * converting it would need road geometry this app does not load. Every preset
 * therefore takes the id-hash fallback and the low-confidence pose personality,
 * the same as headingless Austin and TfL cameras.
 *
 * Attribution: "Fintraffic / digitraffic.fi" (CC BY 4.0), registered in
 * src/data/dataCredits.js.
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadFintrafficSourcesFromOpenData() {
  try {
    const resp = await fetch(FINTRAFFIC_STATIONS_URL, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'Digitraffic-User': DIGITRAFFIC_USER,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (resp.status >= 300 && resp.status < 400) {
      console.warn(
        '[CCTV] Fintraffic station list redirected; redirects are not followed',
      );
      return [];
    }
    if (!resp.ok) {
      console.warn('[CCTV] Fintraffic station download failed:', resp.status);
      return [];
    }
    const payload = await resp.json();
    const features = Array.isArray(payload?.features) ? payload.features : [];
    if (!features.length) return [];

    const cameras = [];
    let stationsSeen = 0;
    for (const feature of features) {
      const props = feature?.properties || {};
      const stationId = String(props.id || '').trim();
      if (!stationId) continue;
      // GATHERING is the only status that means "this station is collecting
      // images right now"; REMOVED_TEMPORARILY and friends would render as
      // permanent Street View / synthetic fallbacks.
      if (String(props.collectionStatus || '').toUpperCase() !== 'GATHERING')
        continue;

      const coords = feature?.geometry?.coordinates;
      const lon = toFiniteNumber(coords?.[0]);
      const lat = toFiniteNumber(coords?.[1]);
      if (!isLikelyFinlandCoordinate(lat, lon)) continue;
      // Third coordinate is metres, but 0 means "not reported" rather than sea
      // level, so only a positive value is a real reading. Prior only: the
      // client's one-shot ground snap corrects it on 3D-tile stacks, and on a
      // no-tileset stack this height is what freezes in.
      const reportedElevation = toFiniteNumber(coords?.[2], 0);
      const groundElevationM =
        reportedElevation > 0
          ? Math.min(1400, reportedElevation)
          : FINTRAFFIC_GROUND_ELEVATION_M;

      stationsSeen += 1;
      for (const preset of props.presets || []) {
        if (preset?.inCollection !== true) continue;
        const presetId = String(preset?.id || '').trim();
        // Strict id shape (station id + two-digit view). Also the guard that
        // keeps a hostile id out of the synthesized frame URL's path.
        if (!/^C\d{7}$/.test(presetId)) continue;
        if (!presetId.startsWith(stationId)) continue;

        const cameraId = `fi-${presetId.toLowerCase()}`;
        const imageUrl = `${FINTRAFFIC_IMAGE_ORIGIN}${presetId}.jpg`;
        cameras.push({
          id: cameraId,
          name: fintrafficCameraName(props.name, stationId, presetId),
          city: 'Finland',
          cityId: 'finland',
          provider: 'Fintraffic',
          lat,
          lon,
          // Headingless personality (see JSDoc), identical to TfL's.
          headingDeg: fallbackHeadingFromId(cameraId),
          headingConfidence: 'low',
          pitchDeg: -18,
          fovDeg: 44,
          rangeM: 145,
          mountHeightM: 8,
          groundElevationM,
          feedType: 'image',
          url: imageUrl,
          snapshotUrl: imageUrl,
          sourceKind: 'fintraffic-open-data',
          license: 'Fintraffic / digitraffic.fi (CC BY 4.0)',
        });
      }
    }

    const maxRaw = Number(
      process.env.CCTV_FINTRAFFIC_MAX_SOURCES || DEFAULT_FINTRAFFIC_MAX_SOURCES,
    );
    const maxCount = Number.isFinite(maxRaw)
      ? Math.max(8, Math.min(600, Math.floor(maxRaw)))
      : DEFAULT_FINTRAFFIC_MAX_SOURCES;
    const prioritized = prioritizeSources(cameras, maxCount, FINLAND_ANCHORS);
    console.log(
      `[CCTV] Loaded Fintraffic camera sources: ${cameras.length} live presets across ${stationsSeen} stations (using nearest ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn(
      '[CCTV] Fintraffic station download error:',
      error?.message || error,
    );
    return [];
  }
}

/**
 * The DriveBC `credit` field mixes third-party image attribution ("Images
 * courtesy of TransLink") with operational notes ("relies on solar power").
 * Only the attribution kind is carried onto the camera, HTML stripped, so a
 * partner-owned feed names its owner in the panel; everything else is dropped.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function driveBcImageCredit(raw) {
  const text = String(raw || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return /courtesy|provided by|presented in cooperation|city of|parks canada/i.test(
    text,
  )
    ? text
    : '';
}

/** DriveBC orientation codes (the eight compass points) as headings in degrees. */
const DRIVEBC_ORIENTATION_HEADINGS = Object.freeze({
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
});

/**
 * Fetch DriveBC highway cameras (British Columbia). Keyless: one list endpoint
 * served by the DriveBC.ca site. Only cameras that are switched on and published
 * (`is_on` and `should_appear`) with a positive integer id and finite coordinates
 * are kept. Frame URLs are built from that id on the official image host and are
 * never read from the payload. Orientation codes give a high-confidence heading;
 * `elevation` is metres above sea level. Attribution: Open Government Licence –
 * British Columbia (registered in src/data/dataCredits.js).
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadDriveBcSourcesFromOpenData() {
  try {
    const resp = await fetch(DRIVEBC_WEBCAMS_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn('[CCTV] DriveBC camera download failed:', resp.status);
      return [];
    }
    const rows = await resp.json();
    if (!Array.isArray(rows)) return [];

    const cameras = [];
    for (const row of rows) {
      if (row?.is_on !== true || row?.should_appear !== true) continue;
      if (!Number.isSafeInteger(row.id) || row.id <= 0) continue;
      // GeoJSON point order: [longitude, latitude].
      const [lon, lat] = Array.isArray(row.location?.coordinates)
        ? row.location.coordinates
        : [];
      if (!isLikelyBcCoordinate(lat, lon)) continue;

      const cameraId = `drivebc-${row.id}`;
      const heading =
        DRIVEBC_ORIENTATION_HEADINGS[
          String(row.orientation || '')
            .trim()
            .toUpperCase()
        ];
      const hasHeading = Number.isFinite(heading);
      const region = String(row.region_name || '').trim();
      const imageUrl = DRIVEBC_IMAGE_URL(row.id);
      const credit = driveBcImageCredit(row.credit);
      cameras.push({
        id: cameraId,
        name: String(row.name || '').trim() || `DriveBC camera ${row.id}`,
        // DriveBC regions: Lower Mainland, Vancouver Island, Southern Interior,
        // Northern, and "Border Cams" for the US crossings.
        city:
          region === 'Border Cams' ? 'BC Border' : region || 'British Columbia',
        cityId: 'british-columbia',
        provider: 'DriveBC',
        lat,
        lon,
        headingDeg: hasHeading ? heading : fallbackHeadingFromId(cameraId),
        headingConfidence: hasHeading ? 'high' : 'low',
        // Same two pose personalities as the other packs: raw priors that the
        // client's ground snap and manual calibration refine.
        pitchDeg: hasHeading ? -24 : -18,
        fovDeg: hasHeading ? 56 : 44,
        rangeM: hasHeading ? 210 : 145,
        mountHeightM: hasHeading ? 10 : 8,
        // Clamped like Caltrans so a garbage value can't fling a camera
        // kilometres up; sea level is the prior for the coastal default anchors.
        groundElevationM: Number.isFinite(row.elevation)
          ? Math.max(-100, Math.min(4000, row.elevation))
          : 0,
        feedType: 'image',
        url: imageUrl,
        snapshotUrl: imageUrl,
        sourceKind: 'drivebc-open-data',
        license: 'DriveBC, Open Government Licence – British Columbia',
        credit,
      });
    }

    const maxRaw = Number(
      process.env.CCTV_DRIVEBC_MAX_SOURCES || DEFAULT_DRIVEBC_MAX_SOURCES,
    );
    // Up to the catalog ceiling, so a BC-only setup can load the whole province.
    const maxCount = Number.isFinite(maxRaw)
      ? Math.max(8, Math.min(1200, Math.floor(maxRaw)))
      : DEFAULT_DRIVEBC_MAX_SOURCES;
    const prioritized = prioritizeSources(cameras, maxCount, DRIVEBC_ANCHORS);
    console.log(
      `[CCTV] Loaded DriveBC camera sources: ${cameras.length} published (using nearest ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn(
      '[CCTV] DriveBC camera download error:',
      error?.message || error,
    );
    return [];
  }
}

/**
 * Normalize one TxDOT district catalog into camera source objects. Split out
 * from the fetch so the shape handling is unit-testable without a network.
 *
 * The payload nests cameras under `roadwayCctvStatuses`, keyed by roadway.
 * Only `Device Online` rows register: an offline TxDOT device keeps serving a
 * stale frame that can be years old and would otherwise look live.
 *
 * @param {object} payload - Parsed GetCctvStatusListByDistrict response.
 * @param {string} district - TxDOT district code, e.g. 'AUS'.
 * @returns {Array<object>} Normalized camera source objects.
 */
export function normalizeTxdotDistrictPayload(payload, district) {
  const byRoadway = payload?.roadwayCctvStatuses;
  if (!byRoadway || typeof byRoadway !== 'object') return [];
  const code = String(district || '').toUpperCase();
  const groundElevationM =
    TXDOT_DISTRICT_ELEVATION_M[code] ?? TXDOT_DEFAULT_ELEVATION_M;
  const cameras = [];
  const seen = new Set();

  for (const rows of Object.values(byRoadway)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (String(row?.statusDescription || '') !== 'Device Online') continue;
      if (row?.hasSnapshot === false) continue;
      // Coordinates must be present as numbers: Number(null) and Number('')
      // are both 0, which would silently park a camera on null island.
      const lat = typeof row?.latitude === 'number' ? row.latitude : NaN;
      const lon = typeof row?.longitude === 'number' ? row.longitude : NaN;
      if (!isLikelyTexasCoordinate(lat, lon)) continue;

      // icd_Id is the device key the snapshot endpoint takes and is unique
      // within a district. An interchange camera appears under both of its
      // roadways, so dedupe on it.
      const icdId = String(row?.icd_Id || '').trim();
      if (!icdId || seen.has(icdId)) continue;
      seen.add(icdId);

      const name = String(row?.name || icdId).trim();
      // Heading comes from an explicit travel token in the NAME ("US-290 EB"),
      // parsed in strict mode: bare cardinals are refused because Texas route
      // names are full of them ("N Lamar", "West Ave"). Deliberately NOT from
      // row.dirDescription / equipLoc.direction: that is the ROADWAY's
      // canonical direction, not the camera's facing (it reads "North" for
      // most Austin rows, including every east-west highway).
      const heading = directionToHeading(name, false);
      const hasHeading = Number.isFinite(heading);
      // The device key itself, base64url-encoded, so every distinct key gets
      // a distinct id (a hash or a slug can collide) and the key is
      // recoverable from the id.
      const cameraId = `txdot-${code.toLowerCase()}-${Buffer.from(icdId, 'utf8').toString('base64url')}`;
      const snapshot = new URL(TXDOT_CCTV_SNAPSHOT_URL);
      snapshot.searchParams.set('icdId', icdId);
      snapshot.searchParams.set('districtCode', code);

      cameras.push({
        id: cameraId,
        name,
        city: String(row?.equipLoc?.roadway || code),
        cityId: `tx-${code.toLowerCase()}`,
        provider: 'TxDOT',
        lat,
        lon,
        headingDeg: hasHeading ? heading : fallbackHeadingFromId(cameraId),
        headingConfidence: hasHeading ? 'high' : 'low',
        // Same two pose personalities as the other packs: raw priors the
        // client's ground snap and manual calibration refine.
        pitchDeg: hasHeading ? -24 : -18,
        fovDeg: hasHeading ? 56 : 44,
        rangeM: hasHeading ? 210 : 145,
        // TxDOT mounts run tall on highway poles and mast arms.
        mountHeightM: hasHeading ? 12 : 10,
        groundElevationM,
        feedType: 'image',
        // JSON carrying a base64 JPEG; media.js decodes it for this origin only.
        url: snapshot.toString(),
        snapshotUrl: snapshot.toString(),
        sourceKind: 'txdot-its',
        license: 'Public TxDOT traffic camera data',
        code: cameraDisplayCode(icdId.toUpperCase()),
      });
    }
  }
  return cameras;
}

/**
 * Fetch TxDOT ITS highway cameras (Texas), keyless. Districts come from
 * CCTV_TXDOT_DISTRICTS (comma-separated codes; empty string disables the
 * pack). One official JSON catalog per district, identical schema statewide;
 * districts fetch in parallel and fail independently.
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadTxdotSourcesFromOpenData() {
  const districtsRaw =
    process.env.CCTV_TXDOT_DISTRICTS ?? DEFAULT_TXDOT_DISTRICTS;
  const districts = [
    ...new Set(
      String(districtsRaw)
        .split(',')
        .map((token) => token.trim().toUpperCase())
        .filter((code) => TXDOT_DISTRICTS.has(code)),
    ),
  ];
  if (!districts.length) return [];

  const settled = await Promise.allSettled(
    districts.map(async (district) => {
      const resp = await fetch(TXDOT_CCTV_STATUS_URL(district), {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'gods-eye-view-cctv-proxy/1.0',
        },
        signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
      });
      if (!resp.ok) throw new Error(`${district} HTTP ${resp.status}`);
      return { district, payload: await resp.json() };
    }),
  );

  const cameras = [];
  for (const result of settled) {
    if (result.status !== 'fulfilled') {
      console.warn(
        '[CCTV] TxDOT district fetch failed:',
        result.reason?.message || result.reason,
      );
      continue;
    }
    cameras.push(
      ...normalizeTxdotDistrictPayload(
        result.value.payload,
        result.value.district,
      ),
    );
  }

  const maxRaw = Number(
    process.env.CCTV_TXDOT_MAX_SOURCES || DEFAULT_TXDOT_MAX_SOURCES,
  );
  const maxCount = Number.isFinite(maxRaw)
    ? Math.max(8, Math.min(2000, Math.floor(maxRaw)))
    : DEFAULT_TXDOT_MAX_SOURCES;
  const prioritized = prioritizeSources(cameras, maxCount, TXDOT_ANCHORS);
  console.log(
    `[CCTV] Loaded TxDOT camera sources: ${cameras.length} online across ${districts.join(',')} (using nearest ${prioritized.length})`,
  );
  return prioritized;
}

/**
 * Load Tallinn intersection cameras from the curated catalog file.
 *
 * Frames are public JPEG stills on ristmikud.tallinn.ee (stable /last/camNNN.jpg
 * URLs). The catalog ships coordinates + curated heading priors; only official
 * ristmikud HTTPS URLs are kept (proxy fetches registered URLs only).
 *
 * @returns {Array<object>} Normalized camera source objects.
 */
export function loadTallinnSourcesFromCatalog({
  sourceRoot = process.cwd(),
} = {}) {
  const sourceFile =
    process.env.CCTV_TALLINN_SOURCES_FILE || DEFAULT_TALLINN_SOURCE_FILE;
  const resolved = path.isAbsolute(sourceFile)
    ? sourceFile
    : path.resolve(sourceRoot, sourceFile);
  let rows = [];
  try {
    if (!fs.existsSync(resolved)) {
      console.warn('[CCTV] Tallinn source file missing:', resolved);
      return [];
    }
    const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    rows = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(
      '[CCTV] Tallinn source file read error:',
      error?.message || error,
    );
    return [];
  }

  const cameras = [];
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const cameraId =
      typeof item.id === 'string' || typeof item.id === 'number'
        ? String(item.id).trim()
        : '';
    if (!cameraId) continue;
    const lat = typeof item.lat === 'number' ? item.lat : NaN;
    const lon = typeof item.lon === 'number' ? item.lon : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // Rough Estonia/Tallinn metro sanity (allows nearby suburbs already in the pack).
    if (lat < 59.2 || lat > 59.7 || lon < 24.3 || lon > 25.4) continue;

    const imageUrl =
      typeof item.url === 'string'
        ? item.url.trim()
        : typeof item.snapshotUrl === 'string'
          ? item.snapshotUrl.trim()
          : '';
    if (!imageUrl.startsWith(TALLINN_IMAGE_ORIGIN)) continue;

    const extractedHeading = toFiniteNumber(item.headingDeg, NaN);
    const hasHeading = Number.isFinite(extractedHeading);
    const headingDeg = hasHeading
      ? ((extractedHeading % 360) + 360) % 360
      : fallbackHeadingFromId(cameraId);
    const headingConfidence = hasHeading
      ? String(item.headingConfidence || '').toLowerCase() === 'low'
        ? 'low'
        : 'high'
      : 'low';
    cameras.push({
      id: cameraId,
      name: String(item.name || cameraId).trim(),
      city: 'Tallinn',
      cityId: 'tallinn',
      provider: 'City of Tallinn',
      lat,
      lon,
      headingDeg,
      headingConfidence,
      pitchDeg: headingConfidence === 'high' ? -24 : -18,
      fovDeg: headingConfidence === 'high' ? 56 : 44,
      rangeM: headingConfidence === 'high' ? 210 : 145,
      mountHeightM: headingConfidence === 'high' ? 10 : 8,
      groundElevationM: toFiniteNumber(item.groundElevationM, 15),
      feedType: 'image',
      url: imageUrl,
      snapshotUrl: imageUrl,
      sourceKind: 'tallinn-ristmikud',
      license: 'Public City of Tallinn traffic camera data',
      poseSource: hasHeading ? 'curated' : undefined,
    });
  }

  const unique = Array.from(
    new Map(cameras.map((camera) => [camera.id, camera])).values(),
  );
  const maxRaw = Number(
    process.env.CCTV_TALLINN_MAX_SOURCES || DEFAULT_TALLINN_MAX_SOURCES,
  );
  const maxCount = Number.isFinite(maxRaw)
    ? Math.max(8, Math.min(300, Math.floor(maxRaw)))
    : DEFAULT_TALLINN_MAX_SOURCES;
  const prioritized = prioritizeSources(unique, maxCount, [TALLINN_CENTER]);
  console.log(
    `[CCTV] Loaded Tallinn camera sources: ${unique.length} (using nearest ${prioritized.length})`,
  );
  return prioritized;
}

/**
 * Extract DATEX2 predefined-location id → {name, lat, lon} from Tarktee XML.
 *
 * @param {string} xml
 * @returns {Map<string,{name:string,lat:number,lon:number}>}
 */
export function parseTarkteeDatexLocations(xml) {
  const out = new Map();
  const blockRe =
    /<predefinedLocation\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/predefinedLocation>/g;
  let match;
  while ((match = blockRe.exec(String(xml || ''))) !== null) {
    const id = match[1];
    const body = match[2];
    // Skip the group container (no coordinates of its own).
    const latMatch = /<latitude>\s*(-?\d+(?:\.\d+)?)\s*<\/latitude>/i.exec(
      body,
    );
    const lonMatch = /<longitude>\s*(-?\d+(?:\.\d+)?)\s*<\/longitude>/i.exec(
      body,
    );
    if (!latMatch || !lonMatch) continue;
    const lat = toFiniteNumber(latMatch[1]);
    const lon = toFiniteNumber(lonMatch[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const nameMatch = /<value\b[^>]*>\s*([^<]+?)\s*<\/value>/i.exec(body);
    const name = nameMatch ? nameMatch[1].trim() : id;
    out.set(id, { name, lat, lon });
  }
  return out;
}

/**
 * Extract DATEX2 traffic-view location id → HTTPS image URL from Tarktee XML.
 *
 * @param {string} xml
 * @returns {Map<string,string>}
 */
export function parseTarkteeDatexImages(xml) {
  const out = new Map();
  const blockRe = /<trafficView\b[^>]*>([\s\S]*?)<\/trafficView>/g;
  let match;
  while ((match = blockRe.exec(String(xml || ''))) !== null) {
    const body = match[1];
    const refMatch =
      /<linearPredefinedLocationReference\b[^>]*\bid="([^"]+)"/i.exec(body);
    const urlMatch = /<urlLinkAddress>\s*([^<\s]+)\s*<\/urlLinkAddress>/i.exec(
      body,
    );
    if (!refMatch || !urlMatch) continue;
    const url = urlMatch[1].trim();
    if (!url.startsWith(TARKTEE_IMAGE_ORIGIN)) continue;
    out.set(refMatch[1], url);
  }
  return out;
}

/**
 * Fetch Estonian Transpordiamet / Tarktee road-weather cameras via DATEX2.
 *
 * Locations and current still URLs are keyless public feeds. Image paths on the
 * ArcGIS MapServer layer go stale; DATEX always carries the current JPEG URL.
 * Only https://tarktee.transpordiamet.ee/images/… URLs are registered.
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadTarkteeSourcesFromDatex() {
  try {
    const [locResp, imgResp] = await Promise.all([
      fetch(TARKTEE_LOCATIONS_URL, {
        headers: { Accept: 'application/xml,text/xml,*/*' },
        signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
      }),
      fetch(TARKTEE_IMAGES_URL, {
        headers: { Accept: 'application/xml,text/xml,*/*' },
        signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
      }),
    ]);
    if (!locResp.ok) {
      console.warn('[CCTV] Tarktee locations download failed:', locResp.status);
      return [];
    }
    if (!imgResp.ok) {
      console.warn('[CCTV] Tarktee images download failed:', imgResp.status);
      return [];
    }
    const [locXml, imgXml] = await Promise.all([
      locResp.text(),
      imgResp.text(),
    ]);
    const locations = parseTarkteeDatexLocations(locXml);
    const images = parseTarkteeDatexImages(imgXml);
    if (!locations.size || !images.size) {
      console.warn('[CCTV] Tarktee DATEX parse empty:', {
        locations: locations.size,
        images: images.size,
      });
      return [];
    }

    const cameras = [];
    for (const [locationId, loc] of locations.entries()) {
      const imageUrl = images.get(locationId);
      if (!imageUrl) continue;
      // Estonia bounding box (mainland + nearby islands).
      if (loc.lat < 57.4 || loc.lat > 59.9 || loc.lon < 21.5 || loc.lon > 28.4)
        continue;

      const numMatch = /\/images\/(\d+)\//.exec(imageUrl);
      const cameraId = numMatch
        ? `ee-tarktee-${numMatch[1]}`
        : `ee-tarktee-${locationId}`;
      cameras.push({
        id: cameraId,
        name: loc.name,
        city: loc.name,
        cityId: 'estonia',
        provider: 'Transpordiamet (Tarktee)',
        lat: loc.lat,
        lon: loc.lon,
        headingDeg: fallbackHeadingFromId(cameraId),
        headingConfidence: 'low',
        pitchDeg: -18,
        fovDeg: 44,
        rangeM: 145,
        mountHeightM: 8,
        groundElevationM: 40,
        feedType: 'image',
        url: imageUrl,
        snapshotUrl: imageUrl,
        sourceKind: 'tarktee-datex',
        license: 'Public Transpordiamet / Tarktee road weather camera data',
      });
    }

    const maxRaw = Number(
      process.env.CCTV_TARKTEE_MAX_SOURCES || DEFAULT_TARKTEE_MAX_SOURCES,
    );
    const maxCount = Number.isFinite(maxRaw)
      ? Math.max(8, Math.min(300, Math.floor(maxRaw)))
      : DEFAULT_TARKTEE_MAX_SOURCES;
    const prioritized = prioritizeSources(cameras, maxCount, TARKTEE_ANCHORS);
    console.log(
      `[CCTV] Loaded Tarktee camera sources: ${cameras.length} with images (using nearest ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn(
      '[CCTV] Tarktee DATEX download error:',
      error?.message || error,
    );
    return [];
  }
}

/**
 * Load the Warendorf municipal webcams (Stadt Warendorf Marktplatz, Kreis
 * Warendorf registration offices) from the curated catalog file. Poses are
 * curated; only the two official municipal image hosts are registered.
 *
 * @returns {Array<object>} Normalized camera source objects.
 */
export function loadWarendorfSourcesFromCatalog({
  sourceRoot = process.cwd(),
} = {}) {
  const sourceFile =
    process.env.CCTV_WARENDORF_SOURCES_FILE || DEFAULT_WARENDORF_SOURCE_FILE;
  const resolved = path.isAbsolute(sourceFile)
    ? sourceFile
    : path.resolve(sourceRoot, sourceFile);
  let rows = [];
  try {
    if (!fs.existsSync(resolved)) {
      console.warn('[CCTV] Warendorf source file missing:', resolved);
      return [];
    }
    const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    rows = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(
      '[CCTV] Warendorf source file read error:',
      error?.message || error,
    );
    return [];
  }
  const cameras = [];
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const url =
      typeof item.url === 'string'
        ? item.url.trim()
        : typeof item.snapshotUrl === 'string'
          ? item.snapshotUrl.trim()
          : '';
    if (!id || !WARENDORF_IMAGE_ORIGINS.some((o) => url.startsWith(o)))
      continue;
    const lat = typeof item.lat === 'number' ? item.lat : NaN;
    const lon = typeof item.lon === 'number' ? item.lon : NaN;
    if (!isPlausibleLatLon(lat, lon)) continue;
    cameras.push({
      ...item,
      id,
      url,
      snapshotUrl: url,
      cityId: String(item.cityId || 'warendorf'),
      feedType: 'image',
      sourceKind: 'municipal-webcam',
    });
  }
  console.log('[CCTV] Loaded Warendorf camera sources:', cameras.length);
  return cameras;
}

/**
 * Label for one NSW camera: its `view` sentence when that is really a view
 * ("5 Ways at The Boulevarde looking west towards Sutherland"), else the
 * title ("5 Ways (Miranda)"). A works notice longer than NSW_MAX_VIEW_LABEL or
 * containing a line break is not a label.
 *
 * @param {{view?:string, title?:string}} props
 * @returns {string}
 */
export function nswCameraLabel(props) {
  const view = String(props?.view || '').trim();
  const title = String(props?.title || '').trim();
  const viewIsALabel =
    view.length > 0 &&
    view.length <= NSW_MAX_VIEW_LABEL &&
    !/[\r\n]/.test(view);
  return viewIsALabel ? view : title;
}

/**
 * One Live Traffic NSW camera feature -> one catalog source, or null. Every
 * camera carries a compass `direction` ("N-E") and a `view` sentence.
 *
 * @param {object} feature - GeoJSON feature from the traffic-cam feed.
 * @returns {?object}
 */
export function nswCameraToSource(feature) {
  const rawId = String(feature?.id || '').trim();
  if (!rawId) return null;
  const coords = feature?.geometry?.coordinates;
  // Numbers only: Number(null) and Number('') are 0, which would park a
  // camera on the equator.
  const lon = typeof coords?.[0] === 'number' ? coords[0] : NaN;
  const lat = typeof coords?.[1] === 'number' ? coords[1] : NaN;
  if (!isLikelyNswCoordinate(lat, lon)) return null;
  const props = feature?.properties || {};
  const url = String(props.href || '').trim();
  if (!url.startsWith(NSW_IMAGE_ORIGIN)) return null;
  // "N-E" -> "NE" for the compass lookup.
  const direction = String(props.direction || '')
    .trim()
    .toUpperCase()
    .replace(/-/g, '');
  const heading = directionToHeading(direction, true);
  const hasHeading = Number.isFinite(heading);
  const cameraId = `nsw-${rawId}`;
  return {
    id: cameraId,
    name: nswCameraLabel(props) || `NSW ${rawId}`,
    city: String(props.region || 'New South Wales').replace(/_/g, ' '),
    cityId: 'nsw',
    provider: 'Live Traffic NSW',
    lat,
    lon,
    headingDeg: hasHeading ? heading : fallbackHeadingFromId(cameraId),
    headingConfidence: hasHeading ? 'high' : 'low',
    pitchDeg: hasHeading ? -24 : -18,
    fovDeg: hasHeading ? 56 : 44,
    rangeM: hasHeading ? 210 : 145,
    mountHeightM: hasHeading ? 10 : 8,
    groundElevationM: 25, // Sydney basin prior; the client's ground snap corrects.
    feedType: 'image',
    url,
    snapshotUrl: url,
    sourceKind: 'nsw-livetraffic',
    license: 'Live Traffic NSW — Transport for NSW, CC BY 4.0',
    code: cameraDisplayCode(String(props.title || '').toUpperCase() || rawId),
  };
}

/**
 * Fetch Live Traffic NSW cameras (New South Wales), keyless: the public
 * traffic-cam GeoJSON feed. Frames are stills on webcams.transport.nsw.gov.au.
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadNswSourcesFromOpenData() {
  try {
    const resp = await fetch(NSW_CAMERAS_URL, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'gods-eye-view-cctv-proxy/1.0',
      },
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn('[CCTV] NSW camera download failed:', resp.status);
      return [];
    }
    const body = await resp.json();
    const features = Array.isArray(body?.features) ? body.features : [];
    const cameras = features.map(nswCameraToSource).filter(Boolean);
    const maxRaw = Number(
      process.env.CCTV_NSW_MAX_SOURCES || DEFAULT_NSW_MAX_SOURCES,
    );
    const maxCount = Number.isFinite(maxRaw)
      ? Math.max(8, Math.min(900, Math.floor(maxRaw)))
      : DEFAULT_NSW_MAX_SOURCES;
    const prioritized = prioritizeSources(cameras, maxCount, [SYDNEY_CENTER]);
    console.log(
      `[CCTV] Loaded NSW camera sources: ${cameras.length} (using nearest ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn('[CCTV] NSW camera download error:', error?.message || error);
    return [];
  }
}

/**
 * Upgrade a catalog frame URL to HTTPS and pin it to the City of Calgary host.
 *
 * Most rows ship `http://`; the host answers HTTPS and 301-redirects there, so
 * upgrading avoids a redirect on every frame fetch. Anything not on the
 * official origin is refused rather than proxied, the same pin the TfL and
 * Tarktee packs apply.
 *
 * @param {string|null|undefined} raw - `camera_url.url` from the dataset.
 * @returns {?string} Pinned HTTPS URL, or null when unusable.
 */
export function normalizeCalgaryImageUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  parsed.protocol = 'https:';
  const upgraded = parsed.toString();
  return upgraded.startsWith(CALGARY_IMAGE_ORIGIN) ? upgraded : null;
}

/**
 * Stable camera id from a frame URL.
 *
 * The dataset carries no id column; the frame filename ("loc86.jpg") is the
 * only stable per-camera token and is what the city keys on. Falls back to a
 * slug of the whole path so a filename-scheme change degrades to a still-stable
 * id rather than dropping the camera.
 *
 * @param {string} imageUrl - A normalized Calgary frame URL.
 * @returns {?string} Provider-stable id, or null when underivable.
 */
export function calgaryCameraId(imageUrl) {
  const text = String(imageUrl ?? '').trim();
  if (!text) return null;
  let path;
  try {
    path = new URL(text).pathname;
  } catch {
    return null;
  }
  const numbered = path.match(/loc(\d+)\.jpg$/i);
  if (numbered) return `calgary-${numbered[1]}`;
  const slug = path
    .replace(/^\/+|\.[a-z0-9]+$/gi, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase();
  return slug ? `calgary-${slug}` : null;
}

/**
 * Label for one Calgary camera: the intersection an operator recognises
 * ("Bow Trail / 37 Street SW"), used verbatim including its quadrant suffix,
 * which is part of the street address. It must never be read as a facing.
 *
 * @param {object} record - Raw Socrata row.
 * @param {string} cameraId - Derived stable id.
 * @returns {string}
 */
export function calgaryCameraName(record, cameraId) {
  const location = String(record?.camera_location ?? '').trim();
  if (location) return location;
  const described = String(record?.camera_url?.description ?? '').trim();
  if (described) return described;
  return `Calgary Camera ${String(cameraId).replace(/^calgary-/, '')}`;
}

/**
 * One Open Calgary row -> one catalog source, or null.
 *
 * NO HEADING IS DERIVED FROM THE RECORD, and the fields that look like one are
 * not. Every row carries a `quadrant` ("NE"/"NW"/"SE"/"SW", and combinations
 * like "NW/NE") and a `camera_location` ending in the same token ("9 Avenue /
 * 3 Street SE"). That is Calgary's address grid — the quarter of the city the
 * intersection sits in — not a camera bearing. Handing either to
 * directionToHeading() returns a confident compass bearing for every row and
 * every one would be wrong. Headings therefore use the shared id-hash fallback
 * at low confidence, exactly as headingless TfL and Fintraffic cameras do, and
 * the operator corrects them with the calibration gizmo.
 *
 * @param {object} record - Raw Socrata row.
 * @returns {?object}
 */
export function calgaryCameraToSource(record) {
  if (!record || typeof record !== 'object') return null;
  const coordinates = record?.point?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lon = toFiniteNumber(coordinates[0]);
  const lat = toFiniteNumber(coordinates[1]);
  if (!isLikelyCalgaryCoordinate(lat, lon)) return null;

  const imageUrl = normalizeCalgaryImageUrl(record?.camera_url?.url);
  if (!imageUrl) return null;
  const cameraId = calgaryCameraId(imageUrl);
  if (!cameraId) return null;
  const name = calgaryCameraName(record, cameraId);

  return {
    id: cameraId,
    name,
    city: 'Calgary',
    cityId: 'calgary',
    provider: 'The City of Calgary',
    lat,
    lon,
    headingDeg: fallbackHeadingFromId(cameraId),
    headingConfidence: 'low',
    pitchDeg: -18,
    fovDeg: 44,
    rangeM: 145,
    mountHeightM: 8,
    // Calgary sits high on the prairie; the client's one-shot ground snap
    // corrects this prior wherever 3D tiles are loaded.
    groundElevationM: 1045,
    feedType: 'image',
    url: imageUrl,
    snapshotUrl: imageUrl,
    sourceKind: 'calgary-open-data',
    license:
      'Contains information licensed under the Open Government Licence – City of Calgary',
    // Unselected-label code: the intersection, so a camera at rest reads as a
    // place rather than as its id.
    code: cameraDisplayCode(name.toUpperCase()),
  };
}

/**
 * Fetch City of Calgary traffic cameras from Open Calgary (Socrata dataset
 * `k7p9-kppz`), keyless. Frames are stills on trafficcam.calgary.ca.
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadCalgarySourcesFromOpenData() {
  try {
    const endpoint =
      process.env.CCTV_CALGARY_ROWS_URL || DEFAULT_CALGARY_ROWS_URL;
    const resp = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    // A response this loader will not read still owns its transport until the
    // body is released, so every rejection path cancels before returning.
    const discard = async () => {
      try {
        await resp.body?.cancel();
      } catch {
        /* no-op */
      }
      return [];
    };
    if (resp.status >= 300 && resp.status < 400) {
      console.warn(
        '[CCTV] Calgary catalog redirected; redirects are not followed',
      );
      return discard();
    }
    if (!resp.ok) {
      console.warn('[CCTV] Calgary camera download failed:', resp.status);
      return discard();
    }
    const rows = await readResponseJsonCapped(resp, CALGARY_MAX_CATALOG_BYTES);
    if (!Array.isArray(rows)) return [];
    const cameras = [];
    const seen = new Set();
    for (const record of rows) {
      const camera = calgaryCameraToSource(record);
      if (!camera || seen.has(camera.id)) continue;
      seen.add(camera.id);
      cameras.push(camera);
    }
    const maxRaw = Number(
      process.env.CCTV_CALGARY_MAX_SOURCES || DEFAULT_CALGARY_MAX_SOURCES,
    );
    const maxCount = Number.isFinite(maxRaw)
      ? Math.max(8, Math.min(400, Math.floor(maxRaw)))
      : DEFAULT_CALGARY_MAX_SOURCES;
    const prioritized = prioritizeSources(cameras, maxCount, [
      CALGARY_DOWNTOWN,
    ]);
    console.log(
      `[CCTV] Loaded Calgary camera sources: ${cameras.length} (using nearest ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn(
      '[CCTV] Calgary camera download error:',
      error?.message || error,
    );
    return [];
  }
}

export async function loadDelDOTSourcesFromOpenData() {
  try {
    const resp = await fetch(DELDOT_CCTV_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
      redirect: 'error',
    });
    if (!resp.ok) {
      console.warn('[CCTV] DelDOT source download failed:', resp.status);
      return [];
    }
    const payload = await readResponseJsonCapped(resp, 2 * 1024 * 1024);
    const rows = Array.isArray(payload?.videoCameras)
      ? payload.videoCameras
      : [];
    if (!rows.length) return [];

    const cameras = [];
    for (const row of rows) {
      if (String(row?.status).toLowerCase() !== 'active') continue;
      const lat = toFiniteNumber(row?.lat);
      const lon = toFiniteNumber(row?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      // Delaware bounding box — a bad upstream coord can't place a camera out of state.
      if (lat < 38.4 || lat > 39.9 || lon < -75.85 || lon > -75.0) continue;

      // Prefer the catalog's HTTPS HLS transport; no subprocess is required.
      let stream;
      try {
        stream = new URL(String(row?.urls?.m3u8s || ''));
      } catch {
        continue;
      }
      if (
        stream.origin !== 'https://video.deldot.gov' ||
        stream.username ||
        stream.password ||
        !/^\/live\/[A-Za-z0-9_.-]+\/playlist\.m3u8$/.test(stream.pathname)
      )
        continue;
      const streamUrl = stream.href;

      const id = String(row?.id || '').trim();
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) continue;
      const cameraId = `deldot-${id.toLowerCase()}`;
      const title = String(row?.title || '').trim();

      // Title carries an unambiguous travel token for ~1 in 5 cameras
      // ("US 13 SB @ ..."). directionToHeading (allowBare=false) matches only
      // NB/SB/EB/WB, never a bare "W"/"N" street prefix — "W NORTH ST" yields
      // no heading and falls back.
      const heading = directionToHeading(title);
      const hasHeading = Number.isFinite(heading);

      cameras.push({
        id: cameraId,
        name: title || `DelDOT ${id}`,
        city: String(row?.county ? `${row.county} County` : 'Delaware'),
        cityId: `deldot-${String(row?.county || 'de')
          .toLowerCase()
          .replace(/\s+/g, '-')}`,
        provider: 'DelDOT',
        lat,
        lon,
        headingDeg: hasHeading ? heading : fallbackHeadingFromId(cameraId),
        headingConfidence: hasHeading ? 'high' : 'low',
        // Fabricated RAW PRIOR poses (same personalities as Austin/Caltrans);
        // the client ground-snap + manual calibration own the truth.
        pitchDeg: hasHeading ? -24 : -18,
        fovDeg: hasHeading ? 56 : 44,
        rangeM: hasHeading ? 210 : 145,
        mountHeightM: hasHeading ? 10 : 8,
        groundElevationM: 10, // Estimated prior; client ground resolution owns placement.
        feedType: 'hls',
        url: streamUrl,
        snapshotUrl: '',
        sourceKind: 'deldot-open-data',
        license: 'Public DelDOT traffic camera',
      });
    }

    const unique = Array.from(
      new Map(cameras.map((camera) => [camera.id, camera])).values(),
    );
    const maxRaw = Number(
      process.env.CCTV_DELDOT_MAX_SOURCES || DEFAULT_DELDOT_MAX_SOURCES,
    );
    const maxCount = Number.isFinite(maxRaw)
      ? Math.max(8, Math.min(400, Math.floor(maxRaw)))
      : DEFAULT_DELDOT_MAX_SOURCES;
    const prioritized = prioritizeSources(unique, maxCount, DELDOT_ANCHORS);
    console.log(
      `[CCTV] Loaded DelDOT camera sources: ${unique.length} Active (using nearest ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn(
      '[CCTV] DelDOT source download error:',
      error?.message || error,
    );
    return [];
  }
}

const XML_NAMED_ENTITIES = Object.freeze({
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  amp: '&',
});

/**
 * Decode the five XML entities and numeric references in element text, in one
 * pass so "&amp;lt;" stays the literal text "&lt;".
 *
 * @param {string} value
 * @returns {string}
 */
export function decodeXmlText(value) {
  return String(value ?? '').replace(
    /&(?:#x([0-9a-f]+)|#(\d+)|(lt|gt|quot|apos|amp));/gi,
    (match, hex, dec, name) => {
      if (name) return XML_NAMED_ENTITIES[name.toLowerCase()];
      const code = hex ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    },
  );
}

/**
 * Text of the first `<localName>` element in `body`, whatever its namespace
 * prefix ("loc:latitude", "latitude"), decoded and trimmed; '' when absent.
 * DATEX II publishers choose their own prefixes, so none is assumed.
 *
 * @param {string} body
 * @param {string} localName
 * @returns {string}
 */
function xmlElementText(body, localName) {
  const match = new RegExp(
    `<(?:[A-Za-z][\\w.-]*:)?${localName}(?:\\s[^>]*)?>([^<]*)</(?:[A-Za-z][\\w.-]*:)?${localName}>`,
  ).exec(String(body || ''));
  return match ? decodeXmlText(match[1]).trim() : '';
}

/**
 * Parse a frame URL and keep it only when it is an HTTPS URL under `origin`
 * (an origin plus optional path prefix) whose path matches `pathPattern`.
 *
 * @param {string} raw
 * @param {string} origin - e.g. 'https://tdcctv.data.one.gov.hk/'
 * @param {RegExp} pathPattern - Tested against the URL pathname.
 * @returns {?string}
 */
function pinnedFrameUrl(raw, origin, pathPattern) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.href.startsWith(origin) ||
    !pathPattern.test(url.pathname)
  )
    return null;
  return url.href;
}

/** Clamp a per-pack env cap the way the other packs do. */
function packCap(raw, fallback, ceiling) {
  const value = Number(raw || fallback);
  return Number.isFinite(value)
    ? Math.max(8, Math.min(ceiling, Math.floor(value)))
    : fallback;
}

/**
 * Fetch one keyless XML catalog without following redirects, reading at most
 * `maxBytes`. Returns '' (after logging) on any failure.
 *
 * @param {string} url
 * @param {number} maxBytes
 * @param {string} label - Pack name for log lines.
 * @returns {Promise<string>}
 */
async function fetchXmlCatalog(url, maxBytes, label) {
  const resp = await fetch(url, {
    headers: {
      Accept: 'application/xml,text/xml',
      'User-Agent': 'gods-eye-view-cctv-proxy/1.0',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) {
    try {
      await resp.body?.cancel();
    } catch {
      /* no-op */
    }
    console.warn(`[CCTV] ${label} camera download failed:`, resp.status);
    return '';
  }
  const { tooLarge, text } = await readCappedResponseText(resp, maxBytes);
  if (tooLarge) {
    console.warn(`[CCTV] ${label} camera catalog exceeds ${maxBytes} bytes`);
    return '';
  }
  return text;
}

/**
 * Parse the Hong Kong Transport Department camera list
 * (Traffic_Camera_Locations_En.xml): one `<image>` per camera with key,
 * region, district, description, latitude, longitude and the frame URL.
 *
 * @param {string} xml
 * @returns {Array<{key:string, region:string, district:string, description:string, lat:number, lon:number, url:string}>}
 */
export function parseHkTdCameraList(xml) {
  const out = [];
  const blockRe = /<image>([\s\S]*?)<\/image>/g;
  let match;
  while ((match = blockRe.exec(String(xml || ''))) !== null) {
    const body = match[1];
    out.push({
      key: xmlElementText(body, 'key'),
      region: xmlElementText(body, 'region'),
      district: xmlElementText(body, 'district'),
      description: xmlElementText(body, 'description'),
      lat: toFiniteNumber(xmlElementText(body, 'latitude')),
      lon: toFiniteNumber(xmlElementText(body, 'longitude')),
      url: xmlElementText(body, 'url'),
    });
  }
  return out;
}

/**
 * One Hong Kong camera entry -> one catalog source, or null.
 *
 * The frame URL is used as published, not rebuilt from the key: the list
 * pairs two Cheung Pei Shan Road cameras (AID09104/AID09206) with each
 * other's frame (seen 2026-10-01), and the publisher is the authority on
 * which image belongs to which entry. A travel token in the description
 * ("- Eastbound") sets the heading, as it does for DelDOT titles.
 *
 * @param {object} entry - From parseHkTdCameraList.
 * @returns {?object}
 */
export function hkTdCameraToSource(entry) {
  const key = String(entry?.key || '').trim();
  if (!/^[A-Za-z0-9]{1,40}$/.test(key)) return null;
  const { lat, lon } = entry;
  if (
    !isPlausibleLatLon(lat, lon) ||
    lat < 22.1 ||
    lat > 22.6 ||
    lon < 113.8 ||
    lon > 114.5
  )
    return null;
  const url = pinnedFrameUrl(
    entry.url,
    HK_TD_IMAGE_ORIGIN,
    /^\/[A-Za-z0-9]+\.jpe?g$/i,
  );
  if (!url) return null;
  // "Aberdeen Praya Road near Fish Market [H429F]" -> drop the key suffix.
  const name =
    String(entry.description || '')
      .replace(/\s*\[[^\]]*\]\s*$/, '')
      .trim() || `Hong Kong ${key}`;
  const heading = directionToHeading(name);
  const hasHeading = Number.isFinite(heading);
  const cameraId = `hk-td-${key.toLowerCase()}`;
  return {
    id: cameraId,
    name,
    city: entry.district || entry.region || 'Hong Kong',
    cityId: 'hong-kong',
    provider: 'Transport Department (Hong Kong)',
    lat,
    lon,
    headingDeg: hasHeading ? heading : fallbackHeadingFromId(cameraId),
    headingConfidence: hasHeading ? 'high' : 'low',
    pitchDeg: hasHeading ? -24 : -18,
    fovDeg: hasHeading ? 56 : 44,
    rangeM: hasHeading ? 210 : 145,
    mountHeightM: hasHeading ? 10 : 8,
    groundElevationM: 10, // Estimated prior; client ground resolution owns placement.
    feedType: 'image',
    url,
    snapshotUrl: url,
    sourceKind: 'hk-td-open-data',
    license: 'Transport Department, HKSAR Government — DATA.GOV.HK',
    code: cameraDisplayCode(name.toUpperCase()),
  };
}

/**
 * Fetch Hong Kong Transport Department traffic snapshot cameras, keyless,
 * from DATA.GOV.HK. Frames are stills on tdcctv.data.one.gov.hk.
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadHkTdSourcesFromOpenData() {
  try {
    const xml = await fetchXmlCatalog(
      HK_TD_CAMERAS_URL,
      HK_TD_MAX_CATALOG_BYTES,
      'Hong Kong',
    );
    if (!xml) return [];
    const cameras = Array.from(
      new Map(
        parseHkTdCameraList(xml)
          .map(hkTdCameraToSource)
          .filter(Boolean)
          .map((camera) => [camera.id, camera]),
      ).values(),
    );
    const maxCount = packCap(
      process.env.CCTV_HK_TD_MAX_SOURCES,
      DEFAULT_HK_TD_MAX_SOURCES,
      1100,
    );
    const prioritized = prioritizeSources(cameras, maxCount, HK_TD_ANCHORS);
    console.log(
      `[CCTV] Loaded Hong Kong camera sources: ${cameras.length} (using nearest ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn(
      '[CCTV] Hong Kong camera download error:',
      error?.message || error,
    );
    return [];
  }
}

/** "CORUÑA, A" -> "Coruña, A"; "VALENCIA/VALÈNCIA" -> "Valencia/València". */
function titleCaseWords(text) {
  return String(text || '')
    .toLocaleLowerCase('es')
    .replace(
      /(^|[\s,/(-])(\p{L})/gu,
      (_, lead, letter) => `${lead}${letter.toLocaleUpperCase('es')}`,
    );
}

/**
 * Parse the DGT DATEX II v3.7 DevicePublication: one `device` per ITS
 * device with its point location, road, kilometre point, province and frame
 * URL. Only devices whose `typeOfDevice` is "camera" are kept.
 *
 * @param {string} xml
 * @returns {Array<{id:string, road:string, destination:string, km:string, province:string, lat:number, lon:number, url:string}>}
 */
export function parseDgtCameraDevices(xml) {
  const out = [];
  const blockRe =
    /<(?:[A-Za-z][\w.-]*:)?device\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z][\w.-]*:)?device>/g;
  let match;
  while ((match = blockRe.exec(String(xml || ''))) !== null) {
    const body = match[2];
    if (xmlElementText(body, 'typeOfDevice') !== 'camera') continue;
    out.push({
      id: (/\bid="([^"]*)"/.exec(match[1])?.[1] || '').trim(),
      road: xmlElementText(body, 'roadName'),
      destination: xmlElementText(body, 'roadDestination'),
      km: xmlElementText(body, 'kilometerPoint'),
      province: xmlElementText(body, 'province'),
      lat: toFiniteNumber(xmlElementText(body, 'latitude')),
      lon: toFiniteNumber(xmlElementText(body, 'longitude')),
      url: xmlElementText(body, 'deviceUrl'),
    });
  }
  return out;
}

/**
 * One DGT camera device -> one catalog source, or null.
 *
 * NO HEADING IS DERIVED. `tpegDirection` is "unknown" for every camera, and
 * `tpegDirectionRoad` ("positive"/"negative") is the direction of rising or
 * falling kilometre points along the road, not a compass bearing. Headings
 * use the id-hash fallback at low confidence, like Calgary.
 *
 * @param {object} device - From parseDgtCameraDevices.
 * @returns {?object}
 */
export function dgtCameraToSource(device) {
  const id = String(device?.id || '').trim();
  if (!/^\d{1,12}$/.test(id)) return null;
  const { lat, lon } = device;
  // Peninsula, Balearic Islands, Ceuta and Melilla (the DGT list has no
  // Canary Islands cameras).
  if (
    !isPlausibleLatLon(lat, lon) ||
    lat < 35.0 ||
    lat > 44.0 ||
    lon < -9.6 ||
    lon > 4.6
  )
    return null;
  const url = pinnedFrameUrl(
    device.url,
    DGT_IMAGE_ORIGIN,
    /^\/camarasEtraffic\/\d+\.jpg$/i,
  );
  if (!url) return null;
  const road = String(device.road || '').trim();
  const km = String(device.km || '').trim();
  const place = [road, km && `km ${km}`].filter(Boolean).join(' ');
  const destination = titleCaseWords(device.destination);
  const name =
    [place, destination && `(→ ${destination})`].filter(Boolean).join(' ') ||
    `DGT ${id}`;
  const cameraId = `es-dgt-${id}`;
  return {
    id: cameraId,
    name,
    city: titleCaseWords(device.province) || 'España',
    cityId: 'es-dgt',
    provider: 'DGT (Dirección General de Tráfico)',
    lat,
    lon,
    headingDeg: fallbackHeadingFromId(cameraId),
    headingConfidence: 'low',
    pitchDeg: -18,
    fovDeg: 44,
    rangeM: 145,
    mountHeightM: 8,
    // Central-plateau prior; the client's ground snap corrects it.
    groundElevationM: 600,
    feedType: 'image',
    url,
    snapshotUrl: url,
    sourceKind: 'dgt-datex',
    license: 'DGT — Dirección General de Tráfico (NAP), CC BY',
    code: cameraDisplayCode((place || `DGT ${id}`).toUpperCase()),
  };
}

/**
 * Fetch Spanish DGT road cameras, keyless, from the national access point
 * (DATEX II v3.7). Frames are stills on etraffic.dgt.es.
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadDgtSourcesFromNap() {
  try {
    const xml = await fetchXmlCatalog(
      DGT_CAMERAS_URL,
      DGT_MAX_CATALOG_BYTES,
      'DGT',
    );
    if (!xml) return [];
    const cameras = Array.from(
      new Map(
        parseDgtCameraDevices(xml)
          .map(dgtCameraToSource)
          .filter(Boolean)
          .map((camera) => [camera.id, camera]),
      ).values(),
    );
    const maxCount = packCap(
      process.env.CCTV_DGT_MAX_SOURCES,
      DEFAULT_DGT_MAX_SOURCES,
      2000,
    );
    const prioritized = prioritizeSources(cameras, maxCount, DGT_ANCHORS);
    console.log(
      `[CCTV] Loaded DGT camera sources: ${cameras.length} (using nearest ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn('[CCTV] DGT camera download error:', error?.message || error);
    return [];
  }
}

/**
 * One NZTA camera -> one catalog source, or null. Cameras the list marks
 * `offline` or `underMaintenance` are skipped. `direction` is a dedicated
 * field ("Southbound"), so it sets the heading.
 *
 * @param {object} camera - One entry of `response.camera`.
 * @returns {?object}
 */
export function nztaCameraToSource(camera) {
  if (!camera || typeof camera !== 'object') return null;
  if (camera.offline === true || camera.underMaintenance === true) return null;
  const rawId = String(camera.id ?? '').trim();
  if (!/^\d{1,9}$/.test(rawId)) return null;
  const lat = typeof camera.latitude === 'number' ? camera.latitude : NaN;
  const lon = typeof camera.longitude === 'number' ? camera.longitude : NaN;
  if (
    !isPlausibleLatLon(lat, lon) ||
    lat < -47.5 ||
    lat > -34.0 ||
    lon < 166.0 ||
    lon > 178.7
  )
    return null;
  let absolute;
  try {
    absolute = new URL(String(camera.imageUrl ?? ''), NZTA_IMAGE_ORIGIN).href;
  } catch {
    return null;
  }
  const url = pinnedFrameUrl(
    absolute,
    NZTA_IMAGE_ORIGIN,
    /^\/camera\/\d+\.jpg$/i,
  );
  if (!url) return null;
  const heading = directionToHeading(String(camera.direction || ''), true);
  const hasHeading = Number.isFinite(heading);
  const cameraId = `nzta-${rawId}`;
  const name =
    String(camera.name || '').trim() ||
    String(camera.description || '').trim() ||
    `NZTA ${rawId}`;
  return {
    id: cameraId,
    name,
    city: String(camera.region?.name || '').trim() || 'New Zealand',
    cityId: 'nz',
    provider: 'NZTA Waka Kotahi',
    lat,
    lon,
    headingDeg: hasHeading ? heading : fallbackHeadingFromId(cameraId),
    headingConfidence: hasHeading ? 'high' : 'low',
    pitchDeg: hasHeading ? -24 : -18,
    fovDeg: hasHeading ? 56 : 44,
    rangeM: hasHeading ? 210 : 145,
    mountHeightM: hasHeading ? 10 : 8,
    groundElevationM: 30, // Estimated prior; client ground resolution owns placement.
    feedType: 'image',
    url,
    snapshotUrl: url,
    sourceKind: 'nzta-traffic',
    license: 'NZTA Waka Kotahi — CC BY 4.0',
    code: cameraDisplayCode(name.toUpperCase()),
  };
}

/**
 * Fetch New Zealand state-highway cameras, keyless, from the NZTA traffic
 * REST API (v5, JSON). Frames are stills on trafficnz.info.
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadNztaSourcesFromApi() {
  try {
    const resp = await fetch(NZTA_CAMERAS_URL, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'gods-eye-view-cctv-proxy/1.0',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      try {
        await resp.body?.cancel();
      } catch {
        /* no-op */
      }
      console.warn('[CCTV] NZTA camera download failed:', resp.status);
      return [];
    }
    const body = await readResponseJsonCapped(resp, NZTA_MAX_CATALOG_BYTES);
    const list = body?.response?.camera;
    // A one-camera response may come back as an object, not an array.
    const rows = Array.isArray(list) ? list : list ? [list] : [];
    const cameras = Array.from(
      new Map(
        rows
          .map(nztaCameraToSource)
          .filter(Boolean)
          .map((camera) => [camera.id, camera]),
      ).values(),
    );
    const maxCount = packCap(
      process.env.CCTV_NZTA_MAX_SOURCES,
      DEFAULT_NZTA_MAX_SOURCES,
      600,
    );
    const prioritized = prioritizeSources(cameras, maxCount, NZTA_ANCHORS);
    console.log(
      `[CCTV] Loaded NZTA camera sources: ${cameras.length} online (using nearest ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn('[CCTV] NZTA camera download error:', error?.message || error);
    return [];
  }
}

const AJAXPRO_TABLE = 'new Ajax.Web.DataTable(';

/**
 * Turn an AjaxPro response into a value WITHOUT evaluating it. AjaxPro writes
 * a DataTable as the JavaScript call `new Ajax.Web.DataTable(columns, rows)`;
 * outside string literals that call becomes the array `[columns, rows]` and
 * the rest is JSON. Any other parenthesis outside a string (another
 * constructor, a function) is refused rather than guessed at.
 *
 * @param {string} text
 * @returns {*}
 */
export function parseAjaxProJson(text) {
  const source = String(text ?? '');
  let out = '';
  let inString = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += source[i + 1] ?? '';
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (source.startsWith(AJAXPRO_TABLE, i)) {
      out += '[';
      i += AJAXPRO_TABLE.length - 1;
    } else if (ch === ')') {
      out += ']';
    } else if (ch === '(') {
      throw new SyntaxError(`unexpected "(" at ${i} in AjaxPro response`);
    } else {
      out += ch;
    }
  }
  return JSON.parse(out);
}

/** `[columns, rows]` from parseAjaxProJson -> one object per row. */
export function ajaxProTableRows(table) {
  if (!Array.isArray(table) || !Array.isArray(table[0])) return [];
  const columns = table[0].map((column) => String(column?.[0] ?? ''));
  const rows = Array.isArray(table[1]) ? table[1] : [];
  return rows
    .filter(Array.isArray)
    .map((row) =>
      Object.fromEntries(columns.map((name, index) => [name, row[index]])),
    );
}

/**
 * Camera rows from the portal's SearchQuery answer: `value` is
 * [folder, [nodes, table, columns], total], and each row's `Location` is a
 * nested table whose `Shape` is a WKT point.
 *
 * @param {string} text - Raw response body.
 * @returns {Array<object>} Rows with `lat`/`lon` added where the point parses.
 */
export function parseHcmcCameraRows(text) {
  const parsed = parseAjaxProJson(text);
  if (parsed?.error) {
    throw new Error(String(parsed.error.Message || 'AjaxPro error'));
  }
  return ajaxProTableRows(parsed?.value?.[1]?.[1]).map((row) => {
    const shape = String(ajaxProTableRows(row.Location)[0]?.Shape ?? '');
    const point =
      /^POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i.exec(
        shape.trim(),
      );
    return {
      ...row,
      lon: point ? Number(point[1]) : NaN,
      lat: point ? Number(point[2]) : NaN,
    };
  });
}

/**
 * One portal camera row -> one catalog source, or null. Only cameras the
 * portal reports as `UP` are kept (it marks dead feeds `NOT_IMAGE`).
 *
 * `Angle`, where present, becomes the heading at LOW confidence: it is a
 * per-camera bearing in degrees on the portal's layer, but the portal does
 * not document it, so the calibration gizmo stays the authority.
 *
 * @param {object} row - From parseHcmcCameraRows.
 * @returns {?object}
 */
export function hcmcCameraToSource(row) {
  if (!row || row.CamStatus !== 'UP') return null;
  const camId = String(row.CamId ?? '').trim();
  if (!/^[0-9a-f]{24}$/i.test(camId)) return null;
  const { lat, lon } = row;
  // The city after the 2025 merger, with Binh Duong and Ba Ria-Vung Tau.
  if (
    !isPlausibleLatLon(lat, lon) ||
    lat < 10.2 ||
    lat > 11.6 ||
    lon < 106.2 ||
    lon > 107.7
  )
    return null;
  const angle =
    row.Angle === null || row.Angle === '' ? NaN : Number(row.Angle);
  const hasAngle = Number.isFinite(angle) && angle >= 0 && angle < 360;
  const cameraId = `vn-hcmc-${camId.toLowerCase()}`;
  const name =
    String(row.DisplayName || '').trim() ||
    String(row.Code || '').trim() ||
    `HCMC ${camId}`;
  const url = `${HCMC_FRAME_URL_PREFIX}${camId.toLowerCase()}`;
  return {
    id: cameraId,
    name,
    city: String(row.Disctrict || '').trim() || 'TP. Hồ Chí Minh',
    cityId: 'vn-hcmc',
    provider: 'Cổng thông tin giao thông TP.HCM',
    lat,
    lon,
    headingDeg: hasAngle ? angle : fallbackHeadingFromId(cameraId),
    headingConfidence: 'low',
    pitchDeg: -18,
    fovDeg: 44,
    rangeM: 145,
    mountHeightM: 8,
    groundElevationM: 5, // Saigon river plain; the client's ground snap corrects.
    feedType: 'image',
    url,
    snapshotUrl: url,
    sourceKind: 'hcmc-portal',
    license:
      'Public camera on giaothong.hochiminhcity.gov.vn (Sở GTVT TP.HCM); no published reuse licence',
    code: cameraDisplayCode(name.toUpperCase()),
  };
}

/** `name=value` pairs from a response's Set-Cookie headers. */
function sessionCookies(resp) {
  const lines =
    typeof resp.headers.getSetCookie === 'function'
      ? resp.headers.getSetCookie()
      : [resp.headers.get('set-cookie')].filter(Boolean);
  return lines
    .map((line) => String(line).split(';')[0].trim())
    .filter((pair) => /^[^=\s]+=/.test(pair))
    .join('; ');
}

/**
 * Fetch the Ho Chi Minh City portal cameras. The portal answers the camera
 * query only inside the anonymous session its map page opens, so the map
 * page is requested first for its cookies (its body is not read), then the
 * map's own query is sent once.
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadHcmcSourcesFromPortal() {
  try {
    const page = await fetch(HCMC_SESSION_URL, {
      headers: { 'User-Agent': 'gods-eye-view-cctv-proxy/1.0' },
      redirect: 'manual',
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    const cookie = sessionCookies(page);
    try {
      await page.body?.cancel();
    } catch {
      /* no-op */
    }
    if (!page.ok || !cookie) {
      console.warn(
        '[CCTV] HCMC portal session failed:',
        page.status,
        cookie ? '' : '(no cookies)',
      );
      return [];
    }
    const resp = await fetch(HCMC_CAMERA_QUERY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-AjaxPro-Method': 'SearchQuery',
        Cookie: cookie,
        Referer: HCMC_SESSION_URL,
        'User-Agent': 'gods-eye-view-cctv-proxy/1.0',
      },
      body: JSON.stringify(HCMC_CAMERA_QUERY),
      redirect: 'error',
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      try {
        await resp.body?.cancel();
      } catch {
        /* no-op */
      }
      console.warn('[CCTV] HCMC camera query failed:', resp.status);
      return [];
    }
    const { tooLarge, text } = await readCappedResponseText(
      resp,
      HCMC_MAX_CATALOG_BYTES,
    );
    if (tooLarge) {
      console.warn('[CCTV] HCMC camera list exceeds the size cap');
      return [];
    }
    const cameras = Array.from(
      new Map(
        parseHcmcCameraRows(text)
          .map(hcmcCameraToSource)
          .filter(Boolean)
          .map((camera) => [camera.id, camera]),
      ).values(),
    );
    const maxCount = packCap(
      process.env.CCTV_HCMC_MAX_SOURCES,
      DEFAULT_HCMC_MAX_SOURCES,
      1000,
    );
    const prioritized = prioritizeSources(cameras, maxCount, HCMC_ANCHORS);
    console.log(
      `[CCTV] Loaded HCMC camera sources: ${cameras.length} up (using nearest ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn('[CCTV] HCMC camera download error:', error?.message || error);
    return [];
  }
}
