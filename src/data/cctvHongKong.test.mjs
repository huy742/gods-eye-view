import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeXmlText,
  hkTdCameraToSource,
  loadHkTdSourcesFromOpenData,
  parseHkTdCameraList,
} from '../../server/providers/cctv/sources.js';
import { HK_TD_CAMERAS_URL } from '../../server/providers/cctv/constants.js';

// Real records from Traffic_Camera_Locations_En.xml (2026-10-01), including the
// AID09104 entry that the publisher pairs with the AID09206 frame.
const image = ({
  key = 'H106F',
  district = 'Central &amp; Western',
  description = 'Connaught Road Central near Exchange Square [H106F]',
  latitude = '22.2859674',
  longitude = '114.1557495',
  url = 'https://tdcctv.data.one.gov.hk/H106F.JPG',
} = {}) => `	<image>
		<key>${key}</key>
		<region>Hong Kong Island</region>
		<district>${district}</district>
		<description>${description}</description>
		<easting>834091</easting>
		<northing>816342</northing>
		<latitude>${latitude}</latitude>
		<longitude>${longitude}</longitude>
		<url>${url}</url>
	</image>`;
const list = (...images) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<image-list>\n${images.join('\n')}\n</image-list>`;
const swapped = image({
  key: 'AID09104',
  district: 'Tsuen Wan',
  description:
    'Cheung Pei Shan Road near Discovery Park - Eastbound [AID09104]',
  latitude: '22.376578385',
  longitude: '114.113827818',
  url: 'https://tdcctv.data.one.gov.hk/AID09206.JPG',
});

test('XML text decoding handles named and numeric entities in one pass', () => {
  assert.equal(decodeXmlText('Central &amp; Western'), 'Central & Western');
  assert.equal(decodeXmlText('&amp;lt;'), '&lt;');
  assert.equal(decodeXmlText('&#233;&#xE9;'), 'éé');
  assert.equal(decodeXmlText('&#0;&bogus;'), '&bogus;');
});

test('a Hong Kong entry maps to a pinned, decoded source without its key suffix', () => {
  const [entry] = parseHkTdCameraList(list(image()));
  const source = hkTdCameraToSource(entry);
  assert.equal(source.id, 'hk-td-h106f');
  assert.equal(source.name, 'Connaught Road Central near Exchange Square');
  assert.equal(source.city, 'Central & Western');
  assert.equal(source.cityId, 'hong-kong');
  assert.equal(source.lat, 22.2859674);
  assert.equal(source.lon, 114.1557495);
  assert.equal(source.url, 'https://tdcctv.data.one.gov.hk/H106F.JPG');
  assert.equal(source.snapshotUrl, source.url);
  assert.equal(source.feedType, 'image');
  assert.equal(source.sourceKind, 'hk-td-open-data');
  assert.match(source.license, /DATA\.GOV\.HK/);
  assert.equal(source.headingConfidence, 'low');
});

test('a travel token sets the heading and the published frame URL is kept', () => {
  const [entry] = parseHkTdCameraList(list(swapped));
  const source = hkTdCameraToSource(entry);
  assert.equal(source.id, 'hk-td-aid09104');
  assert.equal(source.headingDeg, 90);
  assert.equal(source.headingConfidence, 'high');
  assert.equal(source.url, 'https://tdcctv.data.one.gov.hk/AID09206.JPG');
});

test('Hong Kong mapping rejects other hosts, odd URLs, bad keys and far coordinates', () => {
  const map = (overrides) =>
    hkTdCameraToSource(parseHkTdCameraList(list(image(overrides)))[0]);
  for (const url of [
    'https://evil.example/H106F.JPG',
    'http://tdcctv.data.one.gov.hk/H106F.JPG',
    'https://tdcctv.data.one.gov.hk/H106F.JPG?x=1',
    'https://user@tdcctv.data.one.gov.hk/H106F.JPG',
    'https://tdcctv.data.one.gov.hk/image?key=H106F',
    'https://tdcctv.data.one.gov.hk.evil.test/H106F.JPG',
  ])
    assert.equal(map({ url }), null, url);
  assert.equal(map({ key: 'H1 06F' }), null);
  assert.equal(map({ latitude: '40.0' }), null);
  assert.equal(map({ longitude: '' }), null);
});

test('Hong Kong loader reads the keyless list without following redirects', async (t) => {
  t.mock.method(console, 'log', () => {});
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push([String(url), init.redirect]);
    return new Response(
      list(image(), swapped, image({ url: 'https://evil.example/x.JPG' })),
      { headers: { 'Content-Type': 'text/xml' } },
    );
  });
  const cameras = await loadHkTdSourcesFromOpenData();
  assert.deepEqual(requests, [[HK_TD_CAMERAS_URL, 'error']]);
  assert.deepEqual(cameras.map((camera) => camera.id).sort(), [
    'hk-td-aid09104',
    'hk-td-h106f',
  ]);
});

test('Hong Kong loader returns nothing on an upstream error', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('busy', { status: 503 }),
  );
  assert.deepEqual(await loadHkTdSourcesFromOpenData(), []);
});
