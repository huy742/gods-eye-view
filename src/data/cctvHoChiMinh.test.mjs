import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ajaxProTableRows,
  hcmcCameraToSource,
  loadHcmcSourcesFromPortal,
  parseAjaxProJson,
  parseHcmcCameraRows,
} from '../../server/providers/cctv/sources.js';
import {
  HCMC_CAMERA_QUERY,
  HCMC_CAMERA_QUERY_URL,
  HCMC_SESSION_URL,
} from '../../server/providers/cctv/constants.js';

// Shaped like the portal's SearchQuery answer (2026-10-01): the camera table
// is an AjaxPro DataTable call and each Location is a nested one.
const location = (shape) =>
  `new Ajax.Web.DataTable([["GeoId","System.Object"],["Shape","System.Object"],["District","System.Object"]],[["1f7c2a70-f4ea-41ac-8fd9-670b28ec73f3","${shape}",null]])`;
const row = ({
  camId = '662b86c41afb9c00172dd31c',
  code = 'TTH 406',
  shape = 'POINT(106.691054105759 10.7918902432446)',
  status = 'UP',
  angle = null,
  name = 'Trần Quang Khải - Trần Khắc Chân',
} = {}) =>
  `["${camId}","${code}",${location(shape)},"tth",null,"${status}",${angle === null ? 'null' : JSON.stringify(angle)},"${name}"]`;
const answer = (...rows) =>
  `{"value":[{"Type":"folder","Name":"CAMERA"},[[],new Ajax.Web.DataTable([["CamId","System.Object"],["Code","System.Object"],["Location","System.Object"],["CamType","System.Object"],["Disctrict","System.Object"],["CamStatus","System.Object"],["Angle","System.Object"],["DisplayName","System.Object"]],[${rows.join(',')}]),new Ajax.Web.DataTable([["Id","System.Object"]],[])],${rows.length}]}`;

test('AjaxPro DataTable calls become arrays without evaluating the text', () => {
  const parsed = parseAjaxProJson(
    '{"a":new Ajax.Web.DataTable([["x","System.Object"]],[["has ) and ( inside \\" quotes"]])}',
  );
  assert.deepEqual(ajaxProTableRows(parsed.a), [
    { x: 'has ) and ( inside " quotes' },
  ]);
  assert.throws(() => parseAjaxProJson('{"a":new Date(1)}'), SyntaxError);
  assert.throws(() => parseAjaxProJson('{"a":alert(1)}'), SyntaxError);
});

test('portal rows carry their WKT point as lat/lon', () => {
  const [first] = parseHcmcCameraRows(answer(row()));
  assert.equal(first.CamId, '662b86c41afb9c00172dd31c');
  assert.equal(first.lat, 10.7918902432446);
  assert.equal(first.lon, 106.691054105759);
  assert.throws(
    () =>
      parseHcmcCameraRows(
        '{"error":{"Message":"User is not authenticated.","Type":"System.Security.SecurityException"}}',
      ),
    /not authenticated/,
  );
});

test('an UP camera maps to a source framed by the portal image handler', () => {
  const source = hcmcCameraToSource(parseHcmcCameraRows(answer(row()))[0]);
  assert.equal(source.id, 'vn-hcmc-662b86c41afb9c00172dd31c');
  assert.equal(source.name, 'Trần Quang Khải - Trần Khắc Chân');
  assert.equal(source.city, 'TP. Hồ Chí Minh');
  assert.equal(source.cityId, 'vn-hcmc');
  assert.equal(
    source.url,
    'https://giaothong.hochiminhcity.gov.vn/render/ImageHandler.ashx?id=662b86c41afb9c00172dd31c',
  );
  assert.equal(source.snapshotUrl, source.url);
  assert.equal(source.sourceKind, 'hcmc-portal');
  assert.match(source.license, /no published reuse licence/);
  assert.equal(source.headingConfidence, 'low');
});

test('the portal Angle sets the heading, still at low confidence', () => {
  const source = hcmcCameraToSource(
    parseHcmcCameraRows(answer(row({ angle: '270' })))[0],
  );
  assert.equal(source.headingDeg, 270);
  assert.equal(source.headingConfidence, 'low');
});

test('dead feeds, bad ids and far points are skipped', () => {
  const map = (overrides) =>
    hcmcCameraToSource(parseHcmcCameraRows(answer(row(overrides)))[0]);
  assert.equal(map({ status: 'NOT_IMAGE' }), null);
  assert.equal(map({ camId: '../etc/passwd' }), null);
  assert.equal(map({ camId: '662b86c41afb9c00172dd31' }), null);
  assert.equal(map({ shape: 'POINT(105.8342 21.0278)' }), null);
  assert.equal(map({ shape: 'LINESTRING(1 2, 3 4)' }), null);
});

test('the loader opens the map session, then sends the map query once', async (t) => {
  t.mock.method(console, 'log', () => {});
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url) === HCMC_SESSION_URL) {
      const headers = new Headers();
      headers.append('Set-Cookie', 'ASP.NET_SessionId=abc; path=/; HttpOnly');
      headers.append('Set-Cookie', '.VDMS=def; path=/; HttpOnly');
      return new Response('<html></html>', { headers });
    }
    return new Response(
      answer(
        row(),
        row({ camId: '5b0b74280e517b00119fd7f9', status: 'NOT_IMAGE' }),
      ),
      { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  });
  const cameras = await loadHcmcSourcesFromPortal();
  assert.deepEqual(
    cameras.map((camera) => camera.id),
    ['vn-hcmc-662b86c41afb9c00172dd31c'],
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.redirect, 'manual');
  const query = calls[1];
  assert.equal(query.url, HCMC_CAMERA_QUERY_URL);
  assert.equal(query.init.method, 'POST');
  assert.equal(query.init.headers['X-AjaxPro-Method'], 'SearchQuery');
  assert.equal(query.init.headers.Cookie, 'ASP.NET_SessionId=abc; .VDMS=def');
  assert.deepEqual(JSON.parse(query.init.body), HCMC_CAMERA_QUERY);
});

test('no session cookie or an error answer leaves the pack empty', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => new Response('<html></html>'));
  assert.deepEqual(await loadHcmcSourcesFromPortal(), []);
  t.mock.method(globalThis, 'fetch', async (url) =>
    String(url) === HCMC_SESSION_URL
      ? new Response('', { headers: { 'Set-Cookie': 'a=b' } })
      : new Response(
          '{"error":{"Message":"User is not authenticated.","Type":"System.Security.SecurityException"}}',
        ),
  );
  assert.deepEqual(await loadHcmcSourcesFromPortal(), []);
});
