/**
 * @module transitFeeds
 * @description Registry of keyless, openly licensed GTFS-Realtime
 * VehiclePositions feeds the Transit layer can show.
 *
 * Every entry here is a URL the SERVER fetches — the browser only ever asks
 * `/api/transit/vehicles/<id>` for a registered id (see SECURITY.md: proxies
 * never fetch client-supplied URLs). Adding a feed means adding a row here,
 * a DATA_SOURCES.md row with its license, and a credit in dataCredits.js.
 *
 * Admission rules for a feed:
 *  - No key, token, or registration required (identify-yourself headers are
 *    fine — Entur asks for `ET-Client-Name`, OVapi for a User-Agent).
 *  - An open license that permits display with attribution.
 *  - Real coordinates in VehiclePosition.position — NYCT subway, for example,
 *    publishes stop-relative positions only and is deliberately absent.
 *
 * `defaultEnabled` is separate from being registered. A feed ships switched ON
 * only when its operator's own published terms were READ and plainly cover this
 * use. A registered feed with `defaultEnabled: false` is never polled and never
 * offered to the browser; it is here so the decision is visible and reversible
 * in one line. `terms` records the passage that decision rests on, so the next
 * reader does not have to take the licence string on faith.
 *
 * Pure data + pure helpers: imported by the browser layer, the Vite proxy, and
 * node:test. No Cesium, no Node built-ins.
 */

/** Transit modes the layer colors. `routeMode` hints refine a feed's default. */
export const TRANSIT_MODES = Object.freeze([
  'bus',
  'tram',
  'subway',
  'rail',
  'ferry',
  'unknown',
]);

/** Per-mode icon used in labels and the selection card. */
export const TRANSIT_MODE_ICON = Object.freeze({
  bus: '🚌',
  tram: '🚊',
  subway: '🚇',
  rail: '🚆',
  ferry: '⛴️',
  unknown: '🚏',
});

/**
 * MBTA route ids are human-readable and mode-typed: rapid-transit lines carry
 * colour names, commuter rail is prefixed `CR-`, ferries `Boat-`, buses are
 * numeric (or `SL`/`CT` express families).
 * @param {string|null} routeId
 * @returns {string}
 */
function mbtaRouteMode(routeId) {
  if (!routeId) return 'unknown';
  if (/^(Red|Orange|Blue)\b/.test(routeId)) return 'subway';
  if (/^(Green|Mattapan)/.test(routeId)) return 'tram';
  if (/^CR-/.test(routeId)) return 'rail';
  if (/^Boat-/.test(routeId)) return 'ferry';
  if (/^Shuttle/i.test(routeId)) return 'bus';
  return 'bus';
}

/**
 * Entur (Norway) route ids are `<codespace>:Line:<local-id>`; the codespace
 * tells the operator, not the mode, but a few are single-mode operators.
 * @param {string|null} routeId
 * @returns {string}
 */
function enturRouteMode(routeId) {
  if (!routeId) return 'unknown';
  const codespace = routeId.split(':')[0];
  if (
    codespace === 'VYG' ||
    codespace === 'GJB' ||
    codespace === 'SJN' ||
    codespace === 'FLT' ||
    codespace === 'GOA' ||
    codespace === 'NSB' ||
    codespace === 'VYT'
  )
    return 'rail';
  if (codespace === 'FLB') return 'rail';
  return 'bus';
}

/**
 * HSL route ids start with a four-digit code whose first digit is the mode
 * family in HSL's numbering: 1xxx/2xxx… are trams (1001–1010) for 4-digit ids
 * beginning with `10`, metro routes are `31M…`, ferries `1019`.
 * @param {string|null} routeId
 * @returns {string}
 */
function hslRouteMode(routeId) {
  if (!routeId) return 'unknown';
  if (/^31M/.test(routeId)) return 'subway';
  if (/^10(0[1-9]|10|15)/.test(routeId)) return 'tram';
  if (/^1019/.test(routeId)) return 'ferry';
  if (/^300[0-9A-Z]/.test(routeId)) return 'rail';
  return 'bus';
}

/**
 * Metro Transit (Minneapolis–St Paul): light rail is the Blue/Green line
 * (route ids 901/902), Northstar commuter rail is 888.
 * @param {string|null} routeId
 * @returns {string}
 */
function metroTransitRouteMode(routeId) {
  if (!routeId) return 'unknown';
  if (routeId === '901' || routeId === '902') return 'tram';
  if (routeId === '888') return 'rail';
  return 'bus';
}

/**
 * DiviaMobilités (Dijon): the two tram lines are route ids `4-T1` / `4-T2`.
 * @param {string|null} routeId
 * @returns {string}
 */
function diviaRouteMode(routeId) {
  if (!routeId) return 'unknown';
  if (/^4-T\d$/.test(routeId)) return 'tram';
  return 'bus';
}

/** Licence Ouverte 2.0 reuse clause, read 2026-10-01 from the Etalab text. */
const LICENCE_OUVERTE_2_QUOTE =
  "Le « Réutilisateur » est libre de réutiliser l'« Information » ... de la diffuser, la redistribuer, la publier et la transmettre, de l'exploiter à titre commercial ... Sous réserve de : mentionner la paternité de l'« Information » : sa source (a minima le nom du « Concédant ») et la date de la dernière mise à jour de l'« Information » réutilisée. Le « Réutilisateur » peut notamment s'acquitter de cette condition en indiquant l'adresse (URL) renvoyant vers « l'Information »";
const LICENCE_OUVERTE_2_NOTE =
  "Licence named on the dataset's transport.data.gouv.fr page. The credit links that page, which is how the licence says the source and update date may be cited; the vehicles also carry the feed's own timestamp.";

/**
 * Registry of feeds. Order is presentation order in the stats/credit text.
 * `loadRadiusKm` is the distance from `center` inside which the feed is polled.
 * @type {ReadonlyArray<Readonly<{
 *   id: string, name: string, operator: string, region: string,
 *   center: {lat: number, lon: number}, loadRadiusKm: number,
 *   url: string, headers?: Record<string, string>,
 *   license: string, licenseUrl: string, attribution: string,
 *   defaultMode: string, routeMode?: (routeId: string|null) => string,
 * }>>}
 */
export const TRANSIT_FEED_REGISTRY = Object.freeze([
  Object.freeze({
    id: 'mbta',
    historyRetention: true,
    name: 'MBTA',
    operator: 'Massachusetts Bay Transportation Authority',
    region: 'Boston, MA',
    center: Object.freeze({ lat: 42.3601, lon: -71.0589 }),
    loadRadiusKm: 70,
    url: 'https://cdn.mbta.com/realtime/VehiclePositions.pb',
    license: 'MassDOT Developers License Agreement',
    licenseUrl:
      'https://cdn.mbta.com/sites/default/files/2023-08/mbta-massdot-develop-license-agreement.pdf',
    attribution: 'MBTA / MassDOT',
    defaultEnabled: true,
    terms: Object.freeze({
      quote:
        'MassDOT ... hereby grants You (Licensee) non-exclusive, limited, and revocable rights to use, reproduce, and redistribute the Data. ... Clearly acknowledge MassDOT as the provider of the Data.',
      note: 'Credit is text only: the agreement forbids using MBTA/MassDOT logos or trademarks with the data.',
    }),
    defaultMode: 'bus',
    routeMode: mbtaRouteMode,
  }),
  Object.freeze({
    id: 'capmetro-austin',
    name: 'CapMetro',
    operator: 'Capital Metropolitan Transportation Authority',
    region: 'Austin, TX',
    center: Object.freeze({ lat: 30.2672, lon: -97.7431 }),
    loadRadiusKm: 60,
    url: 'https://data.texas.gov/download/eiei-9rpf/application%2Foctet-stream',
    license: 'CapMetro Developer Tools license',
    licenseUrl: 'https://www.capmetro.org/developertools',
    attribution:
      'Capital Metropolitan Transportation Authority — data.texas.gov',
    defaultEnabled: true,
    terms: Object.freeze({
      quote:
        'Capital Metropolitan Transportation Authority (CMTA) hereby grants you (Licensee) non-exclusive, limited and revocable rights to use, reproduce, and redistribute CMTA Data.',
      note: 'CMTA trademarks may not be used in association with the data, so the credit is the operator name as text.',
    }),
    defaultMode: 'bus',
  }),
  Object.freeze({
    id: 'metrotransit-msp',
    name: 'Metro Transit',
    operator: 'Metro Transit (Metropolitan Council)',
    region: 'Minneapolis–St Paul, MN',
    center: Object.freeze({ lat: 44.9778, lon: -93.265 }),
    loadRadiusKm: 70,
    url: 'https://svc.metrotransit.org/mtgtfs/vehiclepositions.pb',
    license: 'Public Metro Transit vehicle position data',
    licenseUrl: 'https://svc.metrotransit.org/',
    attribution: 'Metro Transit — Metropolitan Council',
    defaultEnabled: true,
    terms: Object.freeze({
      quote:
        "Metro Transit's GTFS-realtime feeds are refreshed every 5 seconds.",
      note: 'The realtime feed is published from a developer page carrying operational guidance and no licence text of its own. The public-domain statement below belongs to the Metropolitan Council metadata for the COMPANION SCHEDULE dataset, not to this feed: "None. This dataset is public domain under the Minnesota Government Data Practices Act". Credited as a courtesy, the way the other public agency feeds are.',
    }),
    defaultMode: 'bus',
    routeMode: metroTransitRouteMode,
  }),
  Object.freeze({
    id: 'hsl-helsinki',
    name: 'HSL',
    operator: 'Helsinki Region Transport (HSL)',
    region: 'Helsinki, Finland',
    center: Object.freeze({ lat: 60.1699, lon: 24.9384 }),
    loadRadiusKm: 70,
    url: 'https://realtime.hsl.fi/realtime/vehicle-positions/v2/hsl',
    license: 'CC BY 4.0',
    licenseUrl: 'https://www.hsl.fi/en/hsl/open-data',
    attribution: 'HSL (Helsinki Region Transport)',
    defaultEnabled: true,
    terms: Object.freeze({
      quote: null,
      note: 'The open-data page refuses automated readers (HTTP 403, bot protection), so this entry rests on the owner opening it and accepting it rather than on a passage quoted here. HSL publishes its open data under CC BY 4.0 and asks to be credited as the source; the feed needs no key.',
    }),
    defaultMode: 'bus',
    routeMode: hslRouteMode,
  }),
  Object.freeze({
    id: 'ovapi-nl',
    name: 'OVapi',
    operator: 'Stichting OpenGeo (NDOV data)',
    region: 'Netherlands',
    center: Object.freeze({ lat: 52.2, lon: 5.3 }),
    loadRadiusKm: 220,
    url: 'https://gtfs.ovapi.nl/nl/vehiclePositions.pb',
    license: 'Free to use per the OVapi README (best effort, no SLA)',
    licenseUrl: 'https://gtfs.ovapi.nl/README',
    attribution:
      'OVapi / Stichting OpenGeo — Dutch integrated real-time transit data',
    defaultEnabled: true,
    terms: Object.freeze({
      quote:
        'You are free to use this data, but there is no service level agreement (best-effort) nor are you allowed to say you represent or impersonate any of the transit agencies listed here.',
      note: 'The README asks consumers to identify themselves in the User-Agent, to send If-Modified-Since / If-None-Match when polling faster than once a minute, and to accept gzip. The proxy does all three.',
    }),
    defaultMode: 'bus',
  }),
  Object.freeze({
    id: 'entur-norway',
    name: 'Entur',
    operator: 'Entur AS (Norwegian national transit data)',
    region: 'Norway',
    // Circle chosen to hold Oslo, Bergen, Bodø and Tromsø while leaving
    // Helsinki (≈820 km) out — a national feed must not poll from next door.
    center: Object.freeze({ lat: 64.0, lon: 11.5 }),
    loadRadiusKm: 720,
    url: 'https://api.entur.io/realtime/v1/gtfs-rt/vehicle-positions',
    headers: Object.freeze({ 'ET-Client-Name': 'gods-eye-view-transit' }),
    license: 'Norwegian Licence for Open Government Data (NLOD)',
    licenseUrl: 'https://developer.entur.org/pages-intro-authentication',
    attribution: 'Entur — data under NLOD',
    defaultEnabled: true,
    terms: Object.freeze({
      quote:
        'This API is open under NLOD licence, however, it is required that all consumers identify themselves by using the header ET-Client-Name.',
      note: 'The header is mandatory — unidentified consumers may be rate-limited or blocked — and the proxy sends it on every request.',
    }),
    defaultMode: 'bus',
    routeMode: enturRouteMode,
  }),
  Object.freeze({
    id: 'translink-seq',
    name: 'TransLink',
    operator: 'TransLink (Queensland Government)',
    region: 'South East Queensland, Australia',
    center: Object.freeze({ lat: -27.4698, lon: 153.0251 }),
    loadRadiusKm: 150,
    url: 'https://gtfsrt.api.translink.com.au/api/realtime/seq/VehiclePositions',
    license: 'CC BY 4.0',
    licenseUrl: 'https://translink.com.au/about-translink/open-data',
    attribution: 'TransLink — Queensland Government (CC BY 4.0)',
    defaultEnabled: true,
    terms: Object.freeze({
      quote:
        'Our data is licensed under a Creative Commons Attribution 4.0 International License. ... You must not represent that the State in any way endorses your Application.',
      note: 'No key, no stated rate limit, no caching rule. Logos and network imagery need separate approval, so the credit is text only.',
    }),
    defaultMode: 'bus',
  }),
  Object.freeze({
    id: 'kcm-seattle',
    name: 'King County Metro',
    operator: 'King County Metro Transit',
    region: 'Seattle, WA',
    center: Object.freeze({ lat: 47.6062, lon: -122.3321 }),
    loadRadiusKm: 70,
    url: 'https://s3.amazonaws.com/kcm-alerts-realtime-prod/vehiclepositions.pb',
    license: 'King County Transit Data Terms of Use',
    licenseUrl:
      'https://kingcounty.gov/en/dept/metro/rider-tools/mobile-and-web-apps',
    attribution:
      'Transit scheduling, geographic, and real-time data provided by permission of King County',
    defaultEnabled: true,
    terms: Object.freeze({
      quote:
        'By accessing schedule, geographic, real-time, or any other data posted by King County ("Data"), you agree to these Terms of Use ... King County grants you a limited, revocable license to use, reproduce, and redistribute the Data in accordance with these Terms. ... Should you use the Data for any purposes, you agree to provide the following legend, prominently displayed: "Transit scheduling, geographic, and real-time data provided by permission of King County"',
      note: 'The required legend is the attribution verbatim. The terms forbid the King County logo and service marks, so the credit is text only. Read 2026-10-01 on the Metro developer page that also lists this feed URL.',
    }),
    defaultMode: 'bus',
  }),
  Object.freeze({
    id: 'rtd-denver',
    name: 'RTD',
    operator: 'Regional Transportation District (RTD)',
    region: 'Denver, CO',
    center: Object.freeze({ lat: 39.7392, lon: -104.9903 }),
    loadRadiusKm: 80,
    // The www.rtd-denver.com link answers 308 to this open-data host; the
    // proxy follows same-origin hops only, so the final URL is registered.
    url: 'https://open-data.rtd-denver.com/files/gtfs-rt/rtd/VehiclePosition.pb',
    license: 'RTD GTFS Realtime License Agreement',
    licenseUrl:
      'https://www.rtd-denver.com/open-records/open-spatial-information/gtfs-realtime-license-agreement',
    attribution: 'Regional Transportation District (RTD), Denver',
    defaultEnabled: true,
    terms: Object.freeze({
      quote:
        'RTD hereby grants you non-exclusive, limited and revocable rights to use, reproduce, and redistribute the Data subject to the terms and conditions set forth in this Agreement. RTD trademarks and copyrighted materials, including any confusingly similar variants, may not be used in association with Data.',
      note: 'The agreement is specific to the GTFS Realtime feeds. No trademarks, so the credit is the agency name as text; RTD may ask for an "unofficial, not endorsed" notice, which this app does not claim otherwise.',
    }),
    defaultMode: 'bus',
  }),
  Object.freeze({
    id: 'lignes-dazur-nice',
    name: "Lignes d'Azur",
    operator: "Métropole Nice Côte d'Azur",
    region: 'Nice, France',
    center: Object.freeze({ lat: 43.7102, lon: 7.262 }),
    loadRadiusKm: 50,
    // The data.gouv.fr resource link redirects to this host, so the final
    // URL is registered (the proxy follows same-origin hops only).
    url: 'https://ara-api.enroute.mobi/rla/gtfs/vehicle-positions',
    license: 'Licence Ouverte 2.0',
    licenseUrl:
      'https://transport.data.gouv.fr/datasets/donnees-statiques-et-dynamiques-du-reseau-de-transport-lignes-dazur',
    attribution:
      "Lignes d'Azur — Métropole Nice Côte d'Azur, via transport.data.gouv.fr (Licence Ouverte 2.0)",
    defaultEnabled: true,
    terms: Object.freeze({
      quote: LICENCE_OUVERTE_2_QUOTE,
      note: LICENCE_OUVERTE_2_NOTE,
    }),
    defaultMode: 'bus',
  }),
  Object.freeze({
    id: 'divia-dijon',
    name: 'Divia',
    operator: 'DiviaMobilités (Dijon Métropole)',
    region: 'Dijon, France',
    center: Object.freeze({ lat: 47.322, lon: 5.0415 }),
    loadRadiusKm: 30,
    url: 'https://proxy.transport.data.gouv.fr/resource/divia-dijon-gtfs-rt-vehicle-position',
    license: 'Licence Ouverte 2.0',
    licenseUrl: 'https://transport.data.gouv.fr/datasets/gtfs-diviamobilites',
    attribution:
      'DiviaMobilités — Dijon Métropole, via transport.data.gouv.fr (Licence Ouverte 2.0)',
    defaultEnabled: true,
    terms: Object.freeze({
      quote: LICENCE_OUVERTE_2_QUOTE,
      note: `${LICENCE_OUVERTE_2_NOTE} Served through the national portal's own relay (proxy.transport.data.gouv.fr).`,
    }),
    defaultMode: 'bus',
    routeMode: diviaRouteMode,
  }),
  Object.freeze({
    id: 'lemet-metz',
    name: "Le Met'",
    operator: 'Eurométropole de Metz',
    region: 'Metz, France',
    center: Object.freeze({ lat: 49.1193, lon: 6.1757 }),
    loadRadiusKm: 30,
    url: 'https://proxy.transport.data.gouv.fr/resource/lemet-metz-gtfs-rt-vehicle-position',
    license: 'Licence Ouverte 2.0',
    licenseUrl:
      'https://transport.data.gouv.fr/datasets/fichiers-gtfs-eurometropole-de-metz',
    attribution:
      "Le Met' — Eurométropole de Metz, via transport.data.gouv.fr (Licence Ouverte 2.0)",
    defaultEnabled: true,
    terms: Object.freeze({
      quote: LICENCE_OUVERTE_2_QUOTE,
      note: `${LICENCE_OUVERTE_2_NOTE} Served through the national portal's own relay (proxy.transport.data.gouv.fr).`,
    }),
    defaultMode: 'bus',
  }),
  Object.freeze({
    id: 'bibus-brest',
    name: 'Bibus',
    operator: 'Brest métropole',
    region: 'Brest, France',
    center: Object.freeze({ lat: 48.3904, lon: -4.4861 }),
    loadRadiusKm: 30,
    url: 'https://proxy.transport.data.gouv.fr/resource/bibus-brest-gtfs-rt-vehicle-position',
    license: 'Licence Ouverte 2.0',
    licenseUrl:
      'https://transport.data.gouv.fr/datasets/horaires-theoriques-et-temps-reel-des-bus-et-tramways-circulant-sur-le-territoire-de-brest-metropole',
    attribution:
      'Bibus — Brest métropole, via transport.data.gouv.fr (Licence Ouverte 2.0)',
    defaultEnabled: true,
    terms: Object.freeze({
      quote: LICENCE_OUVERTE_2_QUOTE,
      note: `${LICENCE_OUVERTE_2_NOTE} Served through the national portal's own relay (proxy.transport.data.gouv.fr).`,
    }),
    defaultMode: 'bus',
  }),
]);

/**
 * The feeds this build actually polls. A registered feed that is not here is
 * inert everywhere: it resolves to no route, is never offered to the browser,
 * and never appears in a coverage check.
 */
export const TRANSIT_ENABLED_FEEDS = Object.freeze(
  TRANSIT_FEED_REGISTRY.filter((feed) => feed.defaultEnabled === true),
);

const FEED_BY_ID = new Map(
  TRANSIT_ENABLED_FEEDS.map((feed) => [feed.id, feed]),
);
const ANY_FEED_BY_ID = new Map(
  TRANSIT_FEED_REGISTRY.map((feed) => [feed.id, feed]),
);

/** Feed ids are path segments: lowercase letters, digits, hyphens only. */
export const TRANSIT_FEED_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/**
 * Look up a POLLABLE feed by id. Unknown ids, malformed ids, and feeds that are
 * registered but switched off all return null — this is the only door from a
 * request path to an upstream URL, so a feed the owner has not cleared must not
 * be reachable through it.
 * @param {string} id
 * @returns {object|null}
 */
export function getTransitFeed(id) {
  if (typeof id !== 'string' || !TRANSIT_FEED_ID_PATTERN.test(id)) return null;
  return FEED_BY_ID.get(id) || null;
}

/**
 * Look up any registered feed, enabled or not. For credits and documentation
 * only — never for resolving a request into an upstream fetch.
 * @param {string} id
 * @returns {object|null}
 */
export function getRegisteredTransitFeed(id) {
  if (typeof id !== 'string' || !TRANSIT_FEED_ID_PATTERN.test(id)) return null;
  return ANY_FEED_BY_ID.get(id) || null;
}

/**
 * Great-circle distance in km.
 * @param {number} aLat
 * @param {number} aLon
 * @param {number} bLat
 * @param {number} bLon
 * @returns {number}
 */
export function haversineKm(aLat, aLon, bLat, bLon) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Feeds whose coverage circle contains the point, nearest first.
 * @param {number} lat
 * @param {number} lon
 * @param {number} [slackKm=0] Extra radius (hysteresis) so a feed at the edge
 *   of coverage does not flap on small camera moves.
 * @returns {object[]}
 */
export function transitFeedsInRange(lat, lon, slackKm = 0) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  return TRANSIT_ENABLED_FEEDS.map((feed) => ({
    feed,
    km: haversineKm(lat, lon, feed.center.lat, feed.center.lon),
  }))
    .filter(({ feed, km }) => km <= feed.loadRadiusKm + Math.max(0, slackKm))
    .sort((a, b) => a.km - b.km)
    .map(({ feed }) => feed);
}

/**
 * Mode for a vehicle: the feed's route hint when it has one, else its default.
 * @param {object} feed Registry entry.
 * @param {string|null} routeId GTFS route_id from the vehicle's trip.
 * @returns {string} One of TRANSIT_MODES.
 */
export function transitModeFor(feed, routeId) {
  const hinted =
    typeof feed?.routeMode === 'function' ? feed.routeMode(routeId) : null;
  const mode =
    hinted && hinted !== 'unknown' ? hinted : feed?.defaultMode || 'unknown';
  return TRANSIT_MODES.includes(mode) ? mode : 'unknown';
}

/**
 * Whether the mode came from the route id rather than the feed's default. A
 * default is a guess about a fleet — TransLink's is "bus" while it publishes
 * rail in the same feed — so a consumer judging physical plausibility must
 * not hold a defaulted vehicle to a bus's limits.
 * @param {object} feed Registry entry.
 * @param {string|null} routeId
 * @returns {boolean}
 */
export function transitModeResolved(feed, routeId) {
  const hinted =
    typeof feed?.routeMode === 'function' ? feed.routeMode(routeId) : null;
  return (
    Boolean(hinted) && hinted !== 'unknown' && TRANSIT_MODES.includes(hinted)
  );
}

/**
 * Public catalog shape served by `/api/transit/feeds` — everything the browser
 * needs to gate polling and credit the source, and nothing it could misuse.
 * @returns {object[]}
 */
export function publicTransitCatalog() {
  return TRANSIT_ENABLED_FEEDS.map((feed) => ({
    id: feed.id,
    name: feed.name,
    operator: feed.operator,
    region: feed.region,
    center: { ...feed.center },
    loadRadiusKm: feed.loadRadiusKm,
    license: feed.license,
    licenseUrl: feed.licenseUrl,
    attribution: feed.attribution,
    historyRetention: feed.historyRetention === true,
  }));
}
