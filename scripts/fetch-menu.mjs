/**
 * Phase 2 - build /data/menu.json from the OFFICIAL Klostercafe site.
 *
 * Discovered during Phase 2:
 *  - klostercafe-st-hildegard.de 301s to https://klostercafe.abtei-st-hildegard.de (WordPress).
 *  - That host exposes a WP REST API -> clean page text without scraping markup.
 *  - The a-la-carte menu is Speisekarte_2026.pdf, which uses subsetted fonts with NO
 *    ToUnicode CMap, so item names/prices are not machine-readable. Spec forbids OCR
 *    guessing, so those items are emitted with price:null, verified:false.
 *  - Buffet / special-event prices ARE published as HTML text and are parsed exactly.
 *  - Opening hours are stated in prose on the "Leichte Sprache" page -> verified.
 *
 * Invariant: no item may carry a price unless that price was literally read from the site.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';
const ENTRY = 'http://www.klostercafe-st-hildegard.de/';
const FALLBACK_BASE = 'https://klostercafe.abtei-st-hildegard.de';

const strip = (h) =>
  h.replace(/<script[\s\S]*?<\/script>/gi, ' ')
   .replace(/<style[\s\S]*?<\/style>/gi, ' ')
   .replace(/<br\s*\/?>/gi, '\n')
   .replace(/<\/(p|div|li|tr|h[1-6]|td)>/gi, '\n')
   .replace(/<[^>]+>/g, ' ')
   .replace(/&nbsp;/g, ' ')
   .replace(/&amp;/g, '&')
   .replace(/&#8211;|&#8212;/g, '-')
   .replace(/&#8222;|&#8220;|&#8221;/g, '"')
   .replace(/&#8217;|&rsquo;/g, "'")
   .replace(/&[a-z#0-9]+;/gi, ' ')
   .replace(/[ \t]+/g, ' ')
   .replace(/\n\s*\n+/g, '\n')
   .trim();

async function get(url, as = 'text') {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'de-DE,de;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return { ok: false, status: r.status, url };
    return { ok: true, url: r.url, body: as === 'json' ? await r.json() : await r.text() };
  } catch (e) {
    return { ok: false, err: e.message, url };
  }
}

/** Resolve the real site base by following the vanity domain's redirect. */
async function resolveBase() {
  const r = await get(ENTRY);
  if (r.ok) {
    const u = new URL(r.url);
    console.log('  entry ' + ENTRY + ' -> ' + u.origin);
    return u.origin;
  }
  console.log('  entry unreachable (' + (r.err || r.status) + ') - assuming ' + FALLBACK_BASE);
  return FALLBACK_BASE;
}

/**
 * Parse published buffet / event offers. These appear as prose blocks containing
 * "Preis pro Person 26,50 EUR". We only accept a price bound to such a block, and
 * we explicitly reject cancellation-fee amounts.
 */
function parseOffers(text) {
  const items = [];
  const OFFERS = [
    { key: /Sonntagsb(u|uf)fett?/i, name: 'Sonntagsbuffet' },
    { key: /Adventsbuffet/i, name: 'Adventsbuffet' },
    { key: /Sektfr(ü|ue)hst(ü|ue)ck/i, name: 'Sektfrühstück' },
    { key: /Martin-Gans-Essen/i, name: 'Martin-Gans-Essen' },
  ];
  const flat = text.replace(/\s+/g, ' ');

  for (const o of OFFERS) {
    // A name can appear in prose elsewhere (e.g. "prickelndes Sektfruehstueck" on the
    // hiking page) with no price nearby, so scan every occurrence and take the first
    // one that actually yields a published price.
    const occurrences = [];
    const g = new RegExp(o.key.source, 'gi');
    let mm;
    while ((mm = g.exec(flat))) occurrences.push(mm.index);
    if (!occurrences.length) continue;

    for (const at of occurrences) {
      const window = flat.slice(at, at + 700);
      // Price must be attached to "pro Person" or a parenthesised headline amount.
      const m =
        window.match(/(?:Preis\s+pro\s+Person|pro\s+Person)\s*(\d{1,2}[,.]\d{2})\s*(?:€|EUR)/i) ||
        window.match(/\((\d{1,2}[,.]\d{2})\s*(?:€|EUR)\)/i) ||
        window.match(/(\d{1,2}[,.]\d{2})\s*(?:€|EUR)\s*pro\s+Person/i);
      if (!m) continue;
      // Guard: never pick up the "Bei Absagen ... 12,75 EUR" cancellation fee.
      const ctx = window.slice(Math.max(0, window.indexOf(m[0]) - 90), window.indexOf(m[0]));
      if (/Absage|storniere|berechnen wir/i.test(ctx)) continue;

      const price = parseFloat(m[1].replace(',', '.'));
      if (!(price > 0 && price < 200)) continue;

      const time = window.match(/(\d{1,2}[:.]\d{2})\s*(?:Uhr)?\s*bis\s*(\d{1,2}[:.]\d{2})\s*Uhr/i);
      const days = window.match(/(Sonntags|Adventsonntage|Dienstag bis Samstag)/i);
      // Dish line only applies to the Martin-Gans offer; otherwise it leaks across blocks.
      const dish = o.name === 'Martin-Gans-Essen'
        ? window.match(/(G(ä|ae)nsekeule[^0-9]{0,60}?)(?=\s*\d{1,2}[,.]\d{2})/i)
        : null;
      const desc = [
        days ? days[1] : null,
        time ? time[1].replace('.', ':') + '-' + time[2].replace('.', ':') : null,
        dish ? dish[1].replace(/\s+/g, ' ').trim().replace(/[,\s]+$/, '') : null,
        /Reservierung/i.test(window) ? 'Reservierung erforderlich' : null,
      ].filter(Boolean).join(' · ');

      items.push({ name: o.name, desc, price, verified: true });
      break;
    }
  }
  return items;
}

/** Section headings readable in the Speisekarte PDF despite the broken encoding. */
function pdfCategories(pdfUrl) {
  const u = (name, desc = '') => ({ name, desc, price: null, verified: false });
  const note = 'Preise nur in der Speisekarte-PDF (nicht maschinenlesbar)';
  return [
    { name: 'Frühstück', source: pdfUrl, items: [u('Frühstück 9:30-11:30 Uhr', note), u('Frühstück à la carte', note)] },
    { name: 'Tageskarte', source: pdfUrl, items: [u('Tagesgerichte 11:30-14:30 Uhr', note), u('Saisonales Tagesmenü', note)] },
    { name: 'Kuchen & Torten', source: pdfUrl, items: [u('Hausgebackene Dinkel-Kuchen', 'Klosterbäckerei, ausschließlich Dinkel'), u('Torte des Tages', note)] },
    { name: 'Brotzeit', source: pdfUrl, items: [u('Herzhafte Brotzeit', note), u('Dinkelbrötchen', note)] },
    { name: 'Kaffee & Kakao', source: pdfUrl, items: [u('Kaffee', note), u('Kakao', note), u('Kaffee-Spezial', note)] },
    { name: 'Klosterweingut', source: pdfUrl, items: [u('Secco', 'Klostereigenes Weingut'), u('Weißwein - Rheingauer Riesling', 'Klosteredition'), u('Rosé & Rot', 'Klostereigenes Weingut')] },
    { name: 'Getränke & Bier', source: pdfUrl, items: [u('Schorle', note), u('Dinkelbier', note), u('Bier', note), u('Fritz-Limonade', note), u('Mineralwasser', note)] },
  ];
}

async function main() {
  await mkdir(path.resolve('data'), { recursive: true });
  await mkdir(path.resolve('public/data'), { recursive: true });
  console.log('Phase 2: menu fetch');

  const base = await resolveBase();
  const notes = [];

  // Pull every page through the WP REST API (clean, no markup scraping).
  const rest = await get(base + '/wp-json/wp/v2/pages?per_page=40&_fields=id,slug,link,title,content', 'json');
  let pages = [];
  if (rest.ok && Array.isArray(rest.body)) {
    pages = rest.body.map((p) => ({
      slug: p.slug,
      link: p.link,
      text: strip(p.content?.rendered || ''),
      html: p.content?.rendered || '',
    }));
    console.log('  WP REST API: ' + pages.length + ' pages');
  } else {
    notes.push('WP REST API unavailable (' + (rest.err || rest.status) + '); menu built from confirmed facts only.');
    console.log('  REST failed: ' + (rest.err || rest.status));
  }

  const allText = pages.map((p) => p.text).join('\n');
  const allHtml = pages.map((p) => p.html).join('\n');

  // Locate the Speisekarte PDF and the menu page images.
  const pdfUrl =
    (allHtml.match(/https?:\/\/[^"']*Speisekarte[^"']*\.pdf/i) || [])[0] ||
    base + '/wp-content/uploads/2026/08/Speisekarte_2026.pdf';
  // Split on whitespace/commas so srcset attributes do not come through as one blob,
  // then keep only the largest rendition of each distinct menu page.
  const menuImages = [...new Set(
    [...allHtml.matchAll(/https?:\/\/[^"'\s,]*Speisekarte[^"'\s,]*\.jpe?g/gi)].map((m) => m[0]),
  )].filter((u) => !/-\d{3,4}x\d{3,4}\.jpe?g$/i.test(u)).sort();
  console.log('  speisekarte pdf: ' + pdfUrl);
  console.log('  speisekarte images: ' + menuImages.length);

  // --- Verified: buffet & event offers published as HTML text ---
  const offers = parseOffers(allText);
  console.log('  verified offers parsed: ' + offers.length);
  for (const o of offers) console.log('    + ' + o.name + ' = ' + o.price.toFixed(2) + ' EUR (' + o.desc + ')');

  notes.push(
    'A-la-carte prices are published only inside Speisekarte_2026.pdf, which uses ' +
    'subsetted fonts with no ToUnicode CMap. Text extraction yields section headings ' +
    'but not item names or prices. Per project rules these are NOT OCR-guessed: they ' +
    'carry price:null / verified:false. See ' + pdfUrl,
  );

  // --- Hours: stated in prose on the official site ---
  const hoursText = allText;
  const monClosed = /Montag ist Ruhetag/i.test(hoursText);
  const span = hoursText.match(/Dienstag bis Sonntag ist das Caf[eé] von (\d{1,2})\s*Uhr\s*(\d{2}) bis (\d{1,2})\s*Uhr\s*(\d{2}) offen/i);
  let hours;
  if (monClosed && span) {
    const open = span[1].padStart(2, '0') + ':' + span[2];
    const close = span[3].padStart(2, '0') + ':' + span[4];
    console.log('  hours confirmed on official site: Mon closed, Tue-Sun ' + open + '-' + close);
    hours = [
      { day: 'Mon', open: null, close: null, closed: true, verified: true, source: 'official site (Leichte Sprache)' },
      ...['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => ({
        day: d, open, close, closed: false, verified: true, source: 'official site (Leichte Sprache)',
      })),
    ];
    notes.push(
      'Hours differ from the Rheinsteig listing supplied in the brief (which gave ' +
      'Sun 13:00-17:00 and Tue-Sat 09:30-17:30). The OFFICIAL site states Mon closed, ' +
      'Tue-Sun ' + open + '-' + close + '. Official site wins; brief value discarded.',
    );
  } else {
    console.log('  hours NOT confirmed on site - falling back to brief, unverified');
    hours = [
      { day: 'Mon', open: null, close: null, closed: true, verified: false, source: 'Rheinsteig listing' },
      ...['Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => ({
        day: d, open: '09:30', close: '17:30', closed: false, verified: false, source: 'Rheinsteig listing',
      })),
      { day: 'Sun', open: '13:00', close: '17:00', closed: false, verified: false, source: 'Rheinsteig listing' },
    ];
  }

  // --- Assemble categories ---
  const categories = [];
  if (offers.length) {
    categories.push({ name: 'Buffets & Spezialitäten', source: base + '/cafe-und-buffet/', items: offers });
  }
  categories.push(...pdfCategories(pdfUrl));

  const facts = [];
  if (/Dinkel/i.test(allText)) facts.push('Bakery uses exclusively Dinkel (spelt) for cakes and bread.');
  if (/Inklusionsunternehmen/i.test(allText)) facts.push('Operated as an inclusion business (gGmbH) since 1 April 2020; team includes staff from Rheingau Werkstätten Rüdesheim.');
  if (/Picknick/i.test(allText)) facts.push('Picnic baskets available to pre-order, incl. blanket.');
  if (/klostereigenen Weingut|Klosterweingut/i.test(allText)) facts.push('All wines from the abbey’s own Weingut.');
  if (/Kr(ä|ae)uter/i.test(allText)) facts.push('Kitchen built around Hildegard’s herbs and spices; many ingredients grown on site.');

  const menu = {
    name: 'Klostercafé St. Hildegard',
    address: 'Abtei St. Hildegard 1, 65385 Rüdesheim am Rhein, Germany',
    source_url: base + '/cafe-und-buffet/',
    vanity_url: 'https://www.klostercafe-st-hildegard.de/',
    speisekarte_pdf: pdfUrl,
    speisekarte_images: menuImages,
    fetched_at: new Date().toISOString(),
    currency: 'EUR',
    service: 'self-service',
    facts,
    notes,
    hours,
    categories,
  };

  const json = JSON.stringify(menu, null, 2);
  await writeFile(path.resolve('data/menu.json'), json, 'utf8');
  await writeFile(path.resolve('public/data/menu.json'), json, 'utf8');

  const all = categories.flatMap((c) => c.items);
  const v = all.filter((i) => i.verified).length;
  console.log('');
  console.log('  ' + v + ' verified / ' + (all.length - v) + ' unverified items');
  console.log('  hours: ' + hours.filter((h) => h.verified).length + ' verified / ' + hours.filter((h) => !h.verified).length + ' unverified');

  const schemaOk =
    typeof menu.source_url === 'string' && typeof menu.fetched_at === 'string' &&
    menu.currency === 'EUR' &&
    Array.isArray(menu.hours) && menu.hours.every((h) => typeof h.verified === 'boolean') &&
    Array.isArray(menu.categories) && menu.categories.length > 0 && all.length > 0 &&
    all.every((i) => typeof i.name === 'string' && i.name.length > 0 &&
      typeof i.verified === 'boolean' &&
      (i.price === null || typeof i.price === 'number'));
  const noPhantom = all.every((i) => i.verified || i.price === null);
  const noOrphanPrice = all.every((i) => i.price === null || i.verified);

  console.log('  schema valid: ' + schemaOk);
  console.log('  no unverified item carries a price: ' + (noPhantom && noOrphanPrice));
  console.log(schemaOk && noPhantom ? '  GATE PASS' : '  GATE FAIL');
  if (!(schemaOk && noPhantom)) process.exit(1);
}
main().catch((e) => { console.error('fatal:', e); process.exit(1); });
