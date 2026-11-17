'use strict';
// Spreadsheet files without any outside library: CSV, and .xlsx (a zip of XML files).
window.XL = (() => {
  const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const enc = new TextEncoder();
  const utf8 = new TextDecoder('utf-8');

  // ---------- zip ----------
  const CRC = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++)
      c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    parts.forEach((p) => {
      out.set(p, at);
      at += p.length;
    });
    return out;
  }
  // Files are stored without compression: simple, and spreadsheets of tasks are small.
  function zip(files) {
    const now = new Date();
    const time =
      (now.getHours() << 11) |
      (now.getMinutes() << 5) |
      (now.getSeconds() >> 1);
    const date =
      ((now.getFullYear() - 1980) << 9) |
      ((now.getMonth() + 1) << 5) |
      now.getDate();
    const parts = [];
    const central = [];
    let offset = 0;
    files.forEach((f) => {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 0x0800, true);
      h.setUint16(8, 0, true);
      h.setUint16(10, time, true);
      h.setUint16(12, date, true);
      h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true);
      h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true);
      h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true);
      c.setUint16(12, time, true);
      c.setUint16(14, date, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true);
      c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const size = central.reduce((n, p) => n + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, files.length, true);
    e.setUint16(10, files.length, true);
    e.setUint32(12, size, true);
    e.setUint32(16, offset, true);
    return concat([...parts, ...central, new Uint8Array(e.buffer)]);
  }
  async function inflate(raw) {
    if (typeof DecompressionStream === 'undefined')
      throw new Error(
        'Trình duyệt này quá cũ để đọc file .xlsx. Hãy lưu file dạng .csv rồi thử lại.',
      );
    const stream = new Blob([raw])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(buf) {
    const b = new Uint8Array(buf);
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let end = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--)
      if (v.getUint32(i, true) === 0x06054b50) {
        end = i;
        break;
      }
    if (end < 0)
      throw new Error('File này không phải file Excel (.xlsx) hợp lệ.');
    const count = v.getUint16(end + 10, true);
    let p = v.getUint32(end + 16, true);
    const files = {};
    for (let n = 0; n < count; n++) {
      if (v.getUint32(p, true) !== 0x02014b50)
        throw new Error('File Excel bị hỏng.');
      const method = v.getUint16(p + 10, true);
      const size = v.getUint32(p + 20, true);
      const nameLen = v.getUint16(p + 28, true);
      const extraLen = v.getUint16(p + 30, true);
      const noteLen = v.getUint16(p + 32, true);
      const local = v.getUint32(p + 42, true);
      const name = utf8.decode(b.subarray(p + 46, p + 46 + nameLen));
      const start =
        local +
        30 +
        v.getUint16(local + 26, true) +
        v.getUint16(local + 28, true);
      files[name] = { method, raw: b.subarray(start, start + size) };
      p += 46 + nameLen + extraLen + noteLen;
    }
    return {
      names: Object.keys(files),
      async text(name) {
        const f = files[name];
        if (!f) return null;
        if (f.method === 0) return utf8.decode(f.raw);
        if (f.method === 8) return utf8.decode(await inflate(f.raw));
        throw new Error('File Excel dùng kiểu nén không đọc được.');
      },
    };
  }

  // ---------- xlsx ----------
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const tags = (node, name) => [...node.getElementsByTagNameNS('*', name)];
  const colName = (i) => {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  const colIndex = (ref) => {
    const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase();
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };
  async function readXlsx(buf) {
    const z = await unzip(buf);
    let sheetPath = 'xl/worksheets/sheet1.xml';
    const wb = await z.text('xl/workbook.xml');
    const rels = await z.text('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      const first = tags(xml(wb), 'sheet')[0];
      const rid =
        first &&
        (first.getAttributeNS(REL, 'id') || first.getAttribute('r:id'));
      const rel = tags(xml(rels), 'Relationship').find(
        (r) => r.getAttribute('Id') === rid,
      );
      if (rel) {
        const target = rel.getAttribute('Target');
        sheetPath = target.startsWith('/')
          ? target.slice(1)
          : 'xl/' + target.replace(/^\.\//, '');
      }
    }
    const sharedText = await z.text('xl/sharedStrings.xml');
    const shared = sharedText
      ? tags(xml(sharedText), 'si').map((si) =>
          tags(si, 't')
            .filter((t) => t.parentNode.localName !== 'rPh')
            .map((t) => t.textContent)
            .join(''),
        )
      : [];
    const sheet = await z.text(sheetPath);
    if (!sheet)
      throw new Error('Không tìm thấy trang tính đầu tiên trong file.');
    const rows = [];
    tags(xml(sheet), 'row').forEach((row) => {
      const r = (+row.getAttribute('r') || rows.length + 1) - 1;
      const cells = [];
      let ci = 0;
      tags(row, 'c').forEach((c) => {
        const ref = c.getAttribute('r');
        if (ref) ci = colIndex(ref);
        const type = c.getAttribute('t');
        const v = tags(c, 'v')[0];
        let val = '';
        if (type === 's') val = v ? (shared[+v.textContent] ?? '') : '';
        else if (type === 'inlineStr')
          val = tags(c, 't')
            .map((t) => t.textContent)
            .join('');
        else if (type === 'b')
          val = v && v.textContent === '1' ? 'TRUE' : 'FALSE';
        else if (type === 'str' || type === 'e' || type === 'd')
          val = v ? v.textContent : '';
        else if (v)
          val =
            v.textContent !== '' && !isNaN(+v.textContent)
              ? +v.textContent
              : v.textContent;
        cells[ci] = val;
        ci++;
      });
      rows[r] = Array.from(cells, (x) => (x == null ? '' : x));
    });
    return Array.from(rows, (x) => x || []);
  }
  function writeXlsx(rows, sheetName = 'Trang 1') {
    const x = (s) =>
      String(s ?? '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const name =
      String(sheetName)
        .replace(/[[\]:*?/\\]/g, ' ')
        .slice(0, 31)
        .trim() || 'Trang 1';
    const widths = [];
    rows.forEach((r) =>
      r.forEach((v, j) => {
        const len = Math.max(
          ...String(v ?? '')
            .split('\n')
            .map((l) => l.length),
        );
        widths[j] = Math.min(60, Math.max(widths[j] || 8, len + 2));
      }),
    );
    const cols = widths
      .map(
        (w, j) =>
          `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`,
      )
      .join('');
    const data = rows
      .map(
        (r, i) =>
          `<row r="${i + 1}">${r
            .map((v, j) => {
              const ref = colName(j) + (i + 1);
              const style = i === 0 ? ' s="1"' : '';
              if (typeof v === 'number' && Number.isFinite(v))
                return `<c r="${ref}"${style}><v>${v}</v></c>`;
              const str = String(v ?? '');
              if (!str) return '';
              return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${x(str)}</t></is></c>`;
            })
            .join('')}</row>`,
      )
      .join('');
    const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    return zip([
      {
        name: '[Content_Types].xml',
        data:
          head +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '</Types>',
      },
      {
        name: '_rels/.rels',
        data:
          head +
          `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      },
      {
        name: 'xl/workbook.xml',
        data:
          head +
          `<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="${x(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data:
          head +
          `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
          `<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
      },
      {
        name: 'xl/styles.xml',
        data:
          head +
          `<styleSheet xmlns="${MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
          '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
          '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
          '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
          '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
      },
      {
        name: 'xl/worksheets/sheet1.xml',
        data:
          head +
          `<worksheet xmlns="${MAIN}" xmlns:r="${REL}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
          `<cols>${cols}</cols><sheetData>${data}</sheetData></worksheet>`,
      },
    ]);
  }

  // ---------- csv ----------
  function decodeText(buf) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      // Excel on Vietnamese Windows saves plain CSV in this older encoding.
      return new TextDecoder('windows-1258').decode(buf);
    }
  }
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0] || '';
    const delim = [',', ';', '\t']
      .map((d) => [d, first.split(d).length])
      .sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i++;
          } else quoted = false;
        } else cell += ch;
      } else if (ch === '"' && cell === '') quoted = true;
      else if (ch === delim) {
        row.push(cell);
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }
  const toCsv = (rows) =>
    '﻿' +
    rows
      .map((r) =>
        r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','),
      )
      .join('\r\n');
  async function readTable(file) {
    const name = (file.name || '').toLowerCase();
    const buf = await file.arrayBuffer();
    if (name.endsWith('.xls'))
      throw new Error(
        'File .xls kiểu cũ chưa đọc được. Trong Excel, hãy chọn Lưu thành → .xlsx rồi thử lại.',
      );
    const head = new Uint8Array(buf.slice(0, 2));
    if (name.endsWith('.xlsx') || (head[0] === 0x50 && head[1] === 0x4b))
      return readXlsx(buf);
    return parseCsv(decodeText(buf));
  }

  return {
    zip,
    unzip,
    readXlsx,
    writeXlsx,
    parseCsv,
    toCsv,
    readTable,
    colName,
  };
})();
