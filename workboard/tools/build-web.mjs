// Builds one self-contained page (styles and scripts inlined, no <html>/<head>/<body> wrapper)
// for hosts that publish a single HTML fragment and add their own document shell.
// Usage: node tools/build-web.mjs <output.html>
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');
const out = process.argv[2];
if (!out) {
  console.error('Usage: node tools/build-web.mjs <output.html>');
  process.exit(1);
}

const html = await read('index.html');
const title = html.match(/<title>([^<]*)<\/title>/)[1];
let body = html.match(/<body>([\s\S]*)<\/body>/)[1];
const sources = [...body.matchAll(/<script src="([^"]+)"><\/script>/g)];
for (const [tag, file] of sources) {
  const code = await read(file);
  if (/<\/script/i.test(code))
    throw new Error(
      `${file} contains "</script", which would end the inline script early`,
    );
  body = body.replace(tag, () => `<script>\n${code}</script>`);
}
const css = await read('styles.css');
const page = `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}</style>
${body.trim()}
`;
await writeFile(out, page);
console.log(`Wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
