import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadNztaSourcesFromApi,
  nztaCameraToSource,
} from '../../server/providers/cctv/sources.js';
import { NZTA_CAMERAS_URL } from '../../server/providers/cctv/constants.js';

// Real entries from trafficnz.info REST v5 cameras/all (2026-10-01).
const mayRoad = (overrides = {}) => ({
  description: 'North along Sth Wstn Mwy from May Rd',
  direction: 'Northbound',
  highway: 'SH20',
  id: 653,
  imageUrl: '/camera/653.jpg',
  latitude: -36.90943,
  longitude: 174.73442,
  name: 'SH20 May Rd Overbridge',
  offline: false,
  region: { id: 2, name: 'Auckland' },
  underMaintenance: false,
  ...overrides,
});
const tinwaldOffline = {
  description: 'North along Hinds Highway from Lagmhor Rd',
  direction: 'Northbound',
  highway: 'SH1',
  id: 831,
  imageUrl: '/camera/831.jpg',
  latitude: -43.919508,
  longitude: 171.721221,
  name: 'SH1 Tinwald North',
  offline: true,
  region: { id: 11, name: 'Canterbury' },
  underMaintenance: false,
};

test('an NZTA camera maps to a pinned source with its direction as heading', () => {
  const source = nztaCameraToSource(mayRoad());
  assert.equal(source.id, 'nzta-653');
  assert.equal(source.name, 'SH20 May Rd Overbridge');
  assert.equal(source.city, 'Auckland');
  assert.equal(source.cityId, 'nz');
  assert.equal(source.url, 'https://trafficnz.info/camera/653.jpg');
  assert.equal(source.snapshotUrl, source.url);
  assert.equal(source.headingDeg, 0);
  assert.equal(source.headingConfidence, 'high');
  assert.equal(source.sourceKind, 'nzta-traffic');
  assert.match(source.license, /CC BY 4\.0/);
});

test('NZTA mapping skips offline cameras, other hosts and bad geometry', () => {
  assert.equal(nztaCameraToSource(tinwaldOffline), null);
  assert.equal(nztaCameraToSource(mayRoad({ underMaintenance: true })), null);
  for (const imageUrl of [
    'https://evil.example/camera/653.jpg',
    '//evil.example/camera/653.jpg',
    'http://trafficnz.info/camera/653.jpg',
    '/camera/thumb/653.jpg',
    '/camera/653.jpg?x=1',
  ])
    assert.equal(nztaCameraToSource(mayRoad({ imageUrl })), null, imageUrl);
  assert.equal(nztaCameraToSource(mayRoad({ latitude: '-36.9' })), null);
  assert.equal(nztaCameraToSource(mayRoad({ latitude: 51.5 })), null);
  assert.equal(nztaCameraToSource(mayRoad({ id: 'x' })), null);
  const noDirection = nztaCameraToSource(mayRoad({ direction: '' }));
  assert.equal(noDirection.headingConfidence, 'low');
});

test('NZTA loader asks for JSON and keeps online cameras', async (t) => {
  t.mock.method(console, 'log', () => {});
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push([String(url), init.headers.Accept, init.redirect]);
    return Response.json({
      response: { camera: [mayRoad(), tinwaldOffline] },
    });
  });
  const cameras = await loadNztaSourcesFromApi();
  assert.deepEqual(requests, [[NZTA_CAMERAS_URL, 'application/json', 'error']]);
  assert.deepEqual(
    cameras.map((camera) => camera.id),
    ['nzta-653'],
  );
});

test('NZTA loader accepts a single-camera object and survives failures', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ response: { camera: mayRoad() } }),
  );
  assert.equal((await loadNztaSourcesFromApi()).length, 1);
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed');
  });
  assert.deepEqual(await loadNztaSourcesFromApi(), []);
});
