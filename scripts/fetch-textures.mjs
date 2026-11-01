/**
 * Phase 3 prep - download CC0 Poly Haven textures + one HDRI, at 1K only.
 *
 * Budget strategy: prefer the packed "arm" map (AO/Roughness/Metalness in one RGB
 * texture) over separate AO+Rough+Metal maps. That is 1 upload instead of 3 for the
 * same shading information, which is what keeps us under the 150 MB GPU budget.
 */
import { writeFile, mkdir, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const UA = 'HildegardAssetFetcher/1.0';
const API = 'https://api.polyhaven.com';
const TEX_OUT = path.resolve('public/textures');
const HDRI_OUT = path.resolve('public/hdri');

/** hero = diffuse + normal + arm. flat = diffuse + arm. plain = diffuse only. */
const SETS = [
  { id: 'red_sandstone_wall',   as: 'sandstone',  tier: 'hero'  },
  { id: 'roof_slates_02',       as: 'slate',      tier: 'hero'  },
  { id: 'wood_floor',           as: 'woodfloor',  tier: 'hero'  },
  { id: 'castle_brick_02_red',  as: 'brick',      tier: 'flat'  },
  { id: 'plastered_wall_02',    as: 'plaster',    tier: 'flat'  },
  { id: 'gravel_floor',         as: 'gravel',     tier: 'flat'  },
  { id: 'cobblestone_floor_04', as: 'cobble',     tier: 'flat'  },
  { id: 'brown_mud_leaves_01',  as: 'soil',       tier: 'flat'  },
  { id: 'stone_tiles_02',       as: 'stonetile',  tier: 'plain' },
  { id: 'wood_table',           as: 'woodtable',  tier: 'plain' },
];

const HDRI_CANDIDATES = [
  'kloofendal_48d_partly_cloudy_puresky',
  'syferfontein_1d_clear_puresky',
  'sunflowers_puresky',
  'kloppenheim_06_puresky',
];

const WANT = {
  hero: ['Diffuse', 'nor_gl', 'arm'],
  flat: ['Diffuse', 'arm'],
  plain: ['Diffuse'],
};
const SUFFIX = { Diffuse: 'diff', nor_gl: 'nor', arm: 'arm', Rough: 'rough', AO: 'ao' };

async function json(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(40000) });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
  return r.json();
}

async function download(url, dest) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(dest));
  return (await stat(dest)).size;
}

/** Walk the files tree for a 1k jpg (textures) honouring Poly Haven's shape. */
function pick1k(node) {
  if (!node) return null;
  const k = node['1k'] || node['1K'];
  if (!k) return null;
  return k.jpg?.url || k.png?.url || null;
}

async function main() {
  await mkdir(TEX_OUT, { recursive: true });
  await mkdir(HDRI_OUT, { recursive: true });
  console.log('Phase 3 prep: Poly Haven CC0 assets (1K only)');

  const manifest = { generated: new Date().toISOString(), license: 'CC0 (Poly Haven)', textures: {}, hdri: null };
  let bytes = 0;
  let maps = 0;
  const failures = [];

  for (const s of SETS) {
    let files;
    try {
      files = await json(API + '/files/' + s.id);
    } catch (e) {
      console.log('  ! ' + s.id + ': ' + e.message);
      failures.push(s.id);
      continue;
    }
    const entry = { source: 'https://polyhaven.com/a/' + s.id, license: 'CC0', maps: {} };
    for (const want of WANT[s.tier]) {
      const url = pick1k(files[want]);
      if (!url) {
        // arm is not published for every asset; fall back to Rough so PBR still works.
        if (want === 'arm') {
          const alt = pick1k(files.Rough);
          if (alt) {
            const name = s.as + '_rough_1k.jpg';
            try {
              bytes += await download(alt, path.join(TEX_OUT, name));
              entry.maps.rough = name; maps++;
              console.log('  ' + s.as + ' <- Rough (no arm published)');
            } catch (e) { console.log('  ! ' + name + ': ' + e.message); }
            continue;
          }
        }
        console.log('  - ' + s.id + ' has no ' + want + ' at 1k');
        continue;
      }
      const name = s.as + '_' + SUFFIX[want] + '_1k.jpg';
      try {
        const sz = await download(url, path.join(TEX_OUT, name));
        bytes += sz; maps++;
        entry.maps[SUFFIX[want]] = name;
        console.log('  ' + name.padEnd(28) + (sz / 1024).toFixed(0).padStart(5) + ' KB');
      } catch (e) {
        console.log('  ! ' + name + ': ' + e.message);
        failures.push(name);
      }
    }
    manifest.textures[s.as] = entry;
  }

  // HDRI - first candidate that resolves at 1k.
  for (const id of HDRI_CANDIDATES) {
    try {
      const files = await json(API + '/files/' + id);
      const url = files.hdri?.['1k']?.hdr?.url || files.hdri?.['1k']?.exr?.url;
      if (!url) continue;
      const name = 'sky_1k.hdr';
      const sz = await download(url, path.join(HDRI_OUT, name));
      bytes += sz;
      manifest.hdri = { file: name, id, source: 'https://polyhaven.com/a/' + id, license: 'CC0' };
      console.log('  ' + name.padEnd(28) + (sz / 1024).toFixed(0).padStart(5) + ' KB  (' + id + ')');
      break;
    } catch (e) {
      console.log('  ! hdri ' + id + ': ' + e.message);
    }
  }

  await writeFile(path.join(TEX_OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const attrib = [
    '# Texture & HDRI attribution',
    '',
    'All assets below are **CC0** from [Poly Haven](https://polyhaven.com) - public domain,',
    'no attribution legally required. Listed here for provenance.',
    '',
    '| Local file | Poly Haven asset | License |',
    '|---|---|---|',
    ...Object.entries(manifest.textures).flatMap(([as, e]) =>
      Object.values(e.maps).map((f) => '| `textures/' + f + '` | [' + as + '](' + e.source + ') | CC0 |'),
    ),
    manifest.hdri ? '| `hdri/' + manifest.hdri.file + '` | [' + manifest.hdri.id + '](' + manifest.hdri.source + ') | CC0 |' : '',
    '',
  ].join('\n');
  await writeFile(path.resolve('public/ASSET_ATTRIBUTION.md'), attrib, 'utf8');

  // GPU estimate: 1K RGBA + full mip chain ~= 5.33 MB per map.
  const gpuMB = maps * 5.33;
  const dlMB = bytes / 1048576;
  console.log('');
  console.log('  maps downloaded : ' + maps);
  console.log('  download size   : ' + dlMB.toFixed(1) + ' MB  (budget 120 MB)  ' + (dlMB <= 120 ? 'PASS' : 'FAIL'));
  console.log('  est GPU texture : ' + gpuMB.toFixed(0) + ' MB  (budget 150 MB)  ' + (gpuMB <= 150 ? 'PASS' : 'FAIL'));
  if (failures.length) console.log('  failures: ' + failures.join(', '));
  console.log(maps >= 12 && dlMB <= 120 && gpuMB <= 150 ? '  GATE PASS' : '  GATE CHECK');
}
main().catch((e) => { console.error('fatal:', e); process.exit(1); });
