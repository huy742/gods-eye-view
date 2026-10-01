import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dgtCameraToSource,
  loadDgtSourcesFromNap,
  parseDgtCameraDevices,
} from '../../server/providers/cctv/sources.js';
import { DGT_CAMERAS_URL } from '../../server/providers/cctv/constants.js';

// Real device blocks from camaras_datex2_v37.xml (2026-10-01).
const device = ({
  id = '176130',
  type = 'camera',
  destination = 'BURGOS',
  road = 'A-62',
  latitude = '42.2624',
  longitude = '-3.9403',
  km = '25.3',
  province = 'BURGOS',
  url = 'https://etraffic.dgt.es/camarasEtraffic/176130.jpg',
} = {}) => `    <ns2:device xsi:type="fse:ExtendedDevice" id="${id}" version="2">
        <ns2:typeOfDevice>${type}</ns2:typeOfDevice>
        <ns2:lastUpdateOfDeviceInformation>2025-10-28T14:19:42.000+01:00</ns2:lastUpdateOfDeviceInformation>
        <ns2:pointLocation>
            <loc:supplementaryPositionalDescription>
                <loc:roadInformation>
                    <loc:roadDestination>${destination}</loc:roadDestination>
                    <loc:roadName>${road}</loc:roadName>
                </loc:roadInformation>
            </loc:supplementaryPositionalDescription>
            <loc:tpegPointLocation xsi:type="loc:TpegSimplePoint">
                <loc:tpegDirection>unknown</loc:tpegDirection>
                <loc:tpegSimplePointLocationType>nonLinkedPoint</loc:tpegSimplePointLocationType>
                <loc:point xsi:type="loc:TpegNonJunctionPoint">
                    <loc:pointCoordinates>
                        <loc:latitude>${latitude}</loc:latitude>
                        <loc:longitude>${longitude}</loc:longitude>
                    </loc:pointCoordinates>
                    <loc:_tpegNonJunctionPointExtension>
                        <loc:extendedTpegNonJunctionPoint>
                            <lse:kilometerPoint>${km}</lse:kilometerPoint>
                            <lse:province>${province}</lse:province>
                        </loc:extendedTpegNonJunctionPoint>
                    </loc:_tpegNonJunctionPointExtension>
                </loc:point>
                <loc:_tpegSimplePointExtension>
                    <loc:extendedTpegSimplePoint>
                        <lse:tpegDirectionRoad>negative</lse:tpegDirectionRoad>
                    </loc:extendedTpegSimplePoint>
                </loc:_tpegSimplePointExtension>
            </loc:tpegPointLocation>
        </ns2:pointLocation>
        <fse:deviceUrl>${url}</fse:deviceUrl>
    </ns2:device>`;
const publication = (
  ...devices
) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<d2:payload xsi:type="ns2:DevicePublication" lang="es" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <com:publicationTime>2026-10-01T17:00:01.814+02:00</com:publicationTime>
${devices.join('\n')}
</d2:payload>`;
const leon = device({
  id: '176134',
  destination: 'A CORUÑA',
  road: 'A-6',
  latitude: '42.2278',
  longitude: '-5.8148',
  km: '290.9',
  province: 'LEÓN',
  url: 'https://etraffic.dgt.es/camarasEtraffic/176134.jpg',
});

test('DGT devices parse whatever the namespace prefixes, cameras only', () => {
  const devices = parseDgtCameraDevices(
    publication(device(), device({ id: '9', type: 'variableMessageSign' })),
  );
  assert.deepEqual(devices, [
    {
      id: '176130',
      road: 'A-62',
      destination: 'BURGOS',
      km: '25.3',
      province: 'BURGOS',
      lat: 42.2624,
      lon: -3.9403,
      url: 'https://etraffic.dgt.es/camarasEtraffic/176130.jpg',
    },
  ]);
  const unprefixed = publication(device())
    .replaceAll(/<(\/?)[a-z0-9]+:/g, '<$1')
    .replace('xsi:type', 'type');
  assert.equal(parseDgtCameraDevices(unprefixed)[0]?.id, '176130');
});

test('a DGT camera maps to a pinned source named by road and kilometre point', () => {
  const source = dgtCameraToSource(parseDgtCameraDevices(publication(leon))[0]);
  assert.equal(source.id, 'es-dgt-176134');
  assert.equal(source.name, 'A-6 km 290.9 (→ A Coruña)');
  assert.equal(source.city, 'León');
  assert.equal(source.cityId, 'es-dgt');
  assert.equal(
    source.url,
    'https://etraffic.dgt.es/camarasEtraffic/176134.jpg',
  );
  assert.equal(source.snapshotUrl, source.url);
  assert.equal(source.feedType, 'image');
  assert.equal(source.sourceKind, 'dgt-datex');
  assert.match(source.license, /CC BY/);
  // positive/negative is the kilometre-point direction, never a bearing.
  assert.equal(source.headingConfidence, 'low');
  assert.equal(source.code, 'A-6 KM 290.9');
});

test('DGT mapping rejects other hosts, bad ids and points outside Spain', () => {
  const map = (overrides) =>
    dgtCameraToSource(parseDgtCameraDevices(publication(device(overrides)))[0]);
  for (const url of [
    'https://evil.example/camarasEtraffic/176130.jpg',
    'http://etraffic.dgt.es/camarasEtraffic/176130.jpg',
    'https://etraffic.dgt.es/other/176130.jpg',
    'https://etraffic.dgt.es/camarasEtraffic/176130.jpg?x=1',
  ])
    assert.equal(map({ url }), null, url);
  assert.equal(map({ id: 'abc' }), null);
  assert.equal(map({ latitude: '28.1', longitude: '-15.4' }), null);
  assert.equal(map({ latitude: '' }), null);
});

test('DGT loader reads the national access point without following redirects', async (t) => {
  t.mock.method(console, 'log', () => {});
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push([String(url), init.redirect]);
    return new Response(publication(device(), leon), {
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    });
  });
  const cameras = await loadDgtSourcesFromNap();
  assert.deepEqual(requests, [[DGT_CAMERAS_URL, 'error']]);
  assert.deepEqual(cameras.map((camera) => camera.id).sort(), [
    'es-dgt-176130',
    'es-dgt-176134',
  ]);
});

test('DGT loader returns nothing when the catalog is unreachable', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed');
  });
  assert.deepEqual(await loadDgtSourcesFromNap(), []);
});
