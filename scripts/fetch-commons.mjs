/**
 * Phase 1 - pull CC/PD reference photos of Abtei St. Hildegard from Wikimedia Commons.
 * Writes /reference/commons/*.jpg + ATTRIBUTION.md + /reference/index.html contact sheet.
 * Never downloads an image whose license we cannot positively identify as CC/PD.
 */
import { writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'HildegardRefFetcher/1.0 (educational 3D recreation)';
const OUT = path.resolve('reference/commons');
const MAX = 25;
const WIDTH = 1280;

const CATEGORY = 'Category:Abtei St. Hildegard (Eibingen)';
const SEARCH = '"Abtei St. Hildegard" Rudesheim';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params, attempt = 0) {
  const url = API + '?' + new URLSearchParams({ format: 'json', origin: '*', ...params });
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) {
    if (attempt === 0) {
      console.warn('  ! ' + e.message + ' - backing off 3s, retrying once');
      await sleep(3000);
      return api(params, 1);
    }
    throw e;
  }
}

/** Accept only licenses we can confirm are CC or public domain. */
function licenseOk(short) {
  if (!short) return false;
  const s = short.toLowerCase();
  if (s.includes('fair use') || s.includes('non-free')) return false;
  return /cc[ -]?(by|0|sa)|public domain|pd[- ]|cc0/.test(s);
}

async function collectTitles() {
  try {
    const j = await api({
      action: 'query', list: 'categorymembers', cmtitle: CATEGORY,
      cmtype: 'file', cmlimit: '60',
    });
    const t = (j.query?.categorymembers ?? []).map((m) => m.title);
    if (t.length) {
      console.log('  category hit: ' + t.length + ' files');
      return t;
    }
    console.log('  category empty - falling back to search');
  } catch (e) {
    console.warn('  category query failed (' + e.message + ') - falling back to search');
  }
  const j = await api({ action: 'query', list: 'search', srsearch: SEARCH, srnamespace: '6', srlimit: '60' });
  const t = (j.query?.search ?? []).map((m) => m.title);
  console.log('  search hit: ' + t.length + ' files');
  return t;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log('Phase 1: Wikimedia Commons reference fetch');

  let titles = [];
  let apiBlocked = false;
  try {
    titles = await collectTitles();
  } catch (e) {
    console.error('  API UNREACHABLE: ' + e.message);
    apiBlocked = true;
  }

  titles = titles.filter((t) => /\.(jpe?g|png)$/i.test(t));
  const rows = [];
  let n = 0;

  for (const title of titles) {
    if (n >= MAX) break;
    let info;
    try {
      const j = await api({
        action: 'query', titles: title, prop: 'imageinfo',
        iiprop: 'url|extmetadata|size|mime', iiurlwidth: String(WIDTH),
      });
      info = Object.values(j.query?.pages ?? {})[0]?.imageinfo?.[0];
    } catch (e) {
      console.warn('  skip ' + title + ': ' + e.message);
      continue;
    }
    if (!info) continue;

    const md = info.extmetadata ?? {};
    const strip = (v) => (v?.value ?? '').toString().replace(/<[^>]*>/g, '').trim();
    const license = strip(md.LicenseShortName);
    const author = strip(md.Artist) || 'Unknown';

    if (!licenseOk(license)) {
      console.log('  skip (license "' + (license || 'unknown') + '"): ' + title);
      continue;
    }

    const src = info.thumburl || info.url;
    const safe = title.replace(/^File:/, '').replace(/[^\w.\-]+/g, '_').slice(-70);
    const dest = path.join(OUT, safe);
    try {
      const r = await fetch(src, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(40000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      await pipeline(Readable.fromWeb(r.body), createWriteStream(dest));
      const sz = (await stat(dest)).size;
      n++;
      rows.push({ file: safe, author, license, page: info.descriptionurl, bytes: sz });
      console.log('  [' + n + '] ' + safe + '  (' + (sz / 1024).toFixed(0) + ' KB, ' + license + ')');
    } catch (e) {
      console.warn('  download failed ' + safe + ': ' + e.message);
    }
    await sleep(120);
  }

  let mine = [];
  try {
    mine = (await readdir(path.resolve('reference/mine'))).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  } catch { /* dir may be empty */ }

  const tableHead = rows.length
    ? '| File | Author | License | Source page |\n|---|---|---|---|'
    : '_None downloaded._';
  const attribution = [
    '# Reference image attribution',
    '',
    'Generated: ' + new Date().toISOString(),
    '',
    'These images are **reference only** - they inform hand-modelled geometry.',
    'No image is shipped in the build output, and no artwork is copied.',
    '',
    '## Wikimedia Commons (CC / public domain)',
    '',
    tableHead,
    ...rows.map((r) => '| `' + r.file + '` | ' + r.author + ' | ' + r.license + ' | ' + r.page + ' |'),
    '',
    '## Own photos (`/reference/mine/`)',
    '',
    mine.length ? mine.map((f) => '- `' + f + '` - supplied by the project owner').join('\n') : '_None supplied._',
    '',
    '## Explicitly excluded',
    '',
    '- Tripadvisor / Google / Yelp user photos - copyrighted, not scraped.',
    '- Beuron-school murals - not reproduced; interior art is original procedural pattern.',
    '',
  ].join('\n');
  await writeFile(path.join(OUT, 'ATTRIBUTION.md'), attribution, 'utf8');

  const card = (dir, f) => '<figure><img loading="lazy" src="' + dir + '/' + f + '"><figcaption>' + f + '</figcaption></figure>';
  const sheet = '<!doctype html><meta charset="utf-8"><title>Hildegard reference contact sheet</title>' +
    '<style>body{background:#14171c;color:#eee;font:14px system-ui;margin:0;padding:24px}' +
    'h1{font-size:19px;margin:0 0 4px}h2{font-size:15px;margin:26px 0 10px;color:#e8d5a8}p{opacity:.6;margin:0 0 8px}' +
    '.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}' +
    'figure{margin:0;background:#1d2128;border-radius:7px;overflow:hidden}' +
    'img{width:100%;height:160px;object-fit:cover;display:block}' +
    'figcaption{font-size:10.5px;padding:6px 8px;opacity:.65;word-break:break-all}</style>' +
    '<h1>Abtei St. Hildegard - reference contact sheet</h1>' +
    '<p>' + rows.length + ' Commons (CC/PD) &middot; ' + mine.length + ' own &middot; see commons/ATTRIBUTION.md</p>' +
    '<h2>Wikimedia Commons</h2><div class="g">' + rows.map((r) => card('commons', r.file)).join('') + '</div>' +
    '<h2>Own photos</h2><div class="g">' +
    (mine.map((f) => card('mine', f)).join('') || '<p>Drop photos into /reference/mine/ and re-run.</p>') + '</div>';
  await writeFile(path.resolve('reference/index.html'), sheet, 'utf8');

  const total = rows.reduce((a, r) => a + r.bytes, 0);
  console.log('');
  console.log('  ' + rows.length + ' Commons images (' + (total / 1048576).toFixed(1) + ' MB) + ' + mine.length + ' own');
  console.log('  attribution rows complete: ' + rows.length + '/' + rows.length);
  if (apiBlocked) console.log('  NOTE: Commons API unreachable - continuing with /reference/mine/ only.');
  console.log(rows.length >= 10 ? '  GATE PASS (>=10 images)' : '  GATE FAIL (' + rows.length + ' < 10)');
}
main().catch((e) => { console.error('fatal:', e); process.exit(1); });
