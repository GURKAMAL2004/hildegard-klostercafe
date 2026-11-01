# Klostercafé St. Hildegard — walkable 3D recreation

A real-time, third-person walkable recreation of the Benedictine **Abtei St. Hildegard**
and its **Klostercafé** (Abtei St. Hildegard 1, 65385 Rüdesheim am Rhein).
Three.js + Rapier physics, runs in the browser.

```bash
npm install
npm run assets      # textures + menu + reference photos (needs network)
npm run dev         # http://127.0.0.1:5173
# or
npm run build && npm run preview   # http://127.0.0.1:4173
```

---

## Controls

| Key | Action |
|---|---|
| **W A S D** / arrows | Move |
| **Mouse** | Look (click the canvas once to lock the pointer) |
| **Shift** | Sprint |
| **Space** | Jump |
| **Mouse wheel** | Camera distance (spring arm) |
| **E** | Order — only within 2.6 m of the counter, and only during opening hours |
| **C** | Toggle first / third person |
| **T** | Time-lapse day/night on/off |
| **F** | Fly-cam (free inspection camera) |
| **F1 / F2 / F3** | Quality: Low / Medium / High |
| **M** | Minimap on/off |
| **P** | Print the budget table to the console |
| **Esc** | Close the order overlay |

Suggested first walk: you spawn in the **car park**. Head west/downhill across the
gravel forecourt, past the **Klosterladen & Vinothek**, to the **café wing** — the door
is on its west side. Inside, the self-service counter is along the north wall under the
menu board. Press **E**.

---

## ⚠ Data honesty — what is and is not verified

This was a hard rule of the build: **no price is ever invented.** Items whose price
could not be read from an official source carry `price: null`, `verified: false`, and
render with a ⚠ and "Preis vor Ort" / "Price on site".

### Verified (read literally from the official site)

Source: <https://klostercafe.abtei-st-hildegard.de/cafe-und-buffet/>
(the vanity domain `klostercafe-st-hildegard.de` 301-redirects there)

| Item | Price | Detail |
|---|---|---|
| Sonntagsbuffet | 26,50 € p.p. | Sundays 10:00–12:30 |
| Adventsbuffet | 29,50 € p.p. | Advent Sundays 10:00–12:30 |
| Sektfrühstück | 22,50 € p.p. | Tue–Sat 09:30–12:30 |
| Martin-Gans-Essen | 34,50 € p.p. | Gänsekeule, Rotkraut, Knödel, Dessert · reservation |

**Opening hours — verified.** The official site states, in its *Leichte Sprache* page:
*"Montag ist Ruhetag. Dienstag bis Sonntag ist das Café von 9 Uhr 30 bis 17 Uhr 30 offen."*

→ **Mon closed; Tue–Sun 09:30–17:30.**

> **This contradicts the brief.** The brief supplied a Rheinsteig listing giving
> Tue–Sat 09:30–17:30 and **Sun 13:00–17:00**. The official site says Sunday runs to
> **17:30**, like every other open day. The official site wins; the Rheinsteig Sunday
> value was discarded. Recorded in `menu.json → notes`.

### Unverified (19 items) — `verified: false`, `price: null`

The à la carte menu is published **only** as `Speisekarte_2026.pdf` (6.2 MB). That PDF
uses subsetted fonts with **no `ToUnicode` CMap**, so text extraction returns section
headings but garbles every item name and price into control characters. I tried both
raw stream extraction and CMap-based glyph remapping (0 CMaps found). Per the project
rule, these were **not** OCR-guessed.

What *is* genuine is the **category structure**, which survived as readable ASCII in the
PDF: Frühstück · Frühstück à la carte · Tageskarte · Kaffee & Kakao · Kaffee-Spezial ·
Klosterweingut (Secco / Weiß / Rosé & Rot) · Getränke & Bier · Schorle · Dinkelbier ·
Mineralwasser · Fritz.

Every item inside those categories is a placeholder flagged ⚠. **For real prices, see
the PDF**, linked in `menu.json → speisekarte_pdf`, plus the 5 menu page images in
`speisekarte_images`.

### Other confirmed facts used in the build

- Bakery uses **exclusively Dinkel (spelt)** for cakes and bread.
- Operated as an **inclusion business** (gGmbH) since 1 April 2020; team includes staff
  from **Rheingau Werkstätten Rüdesheim**.
- All wines from the **abbey's own Weingut** (Rheingauer Riesling, Klosteredition).
- **Picnic baskets** to pre-order, incl. blanket. Dog-friendly.
- Separate **Klosterladen & Vinothek**; **sculpture park** behind the café.

---

## Ordering is simulated

The order loop is entirely local: pressing **E** opens an overlay, "Bestellung aufgeben"
prints an in-game receipt (downloadable as PNG), the barista plays a 3-second prepare
animation, and a tray spawns on the nearest free table.

**No real payment. No network request is ever made to the café.** Outside opening hours
the counter shows *"Geschlossen / Closed"* instead of the order prompt.

---

## Data sources & attribution

| What | Source | License |
|---|---|---|
| Textures (21 maps, 1K) | [Poly Haven](https://polyhaven.com) | **CC0** — see `public/ASSET_ATTRIBUTION.md` |
| Sky HDRI (1K) | Poly Haven `kloofendal_48d_partly_cloudy_puresky` | **CC0** |
| Reference photos (20) | Wikimedia Commons | CC BY-SA / CC BY / PD — see `reference/commons/ATTRIBUTION.md` |
| Menu, hours, facts | official café site (WordPress REST API) | factual data |

Open `reference/index.html` for the contact sheet of all reference imagery.

### Deliberately excluded

- **No Tripadvisor / Google / Yelp photos** — copyrighted, not scraped.
- **No reproduction of the Beuron-school murals.** The apse interior uses an *original
  procedural* pattern (concentric gold arcs, radial rays, a geometric mandorla) drawn to
  a canvas at runtime. It evokes the style; it copies no artwork.
- Reference photos inform hand-modelled geometry only. **None ship in the build output** —
  `dist/` contains no Commons imagery.

### Using your own photos

Drop any `.jpg/.png/.webp` into `reference/mine/` and run `npm run fetch:commons`.
They are added to the contact sheet and listed in `ATTRIBUTION.md` as yours. They are
reference material for modelling — nothing is auto-applied as a texture.

---

## Architecture

```
src/
  core/     assets.ts    texture + material cache (dedup by key, prevents RAM blowup)
            physics.ts   Rapier wrapper — only ctor awaits RAPIER.init() first
            quality.ts   Low / Medium / High presets
  world/    terrain.ts   ONE heightAt() drives both the mesh and the Rapier heightfield
            vineyard.ts  InstancedMesh vines, 2 LODs, distance cull, no shadow casting
            kit.ts       modular neo-Romanesque kit (walls, round arches, towers, roofs)
            buildings.ts site assembly: church, cloister, café, shop, terrace, sculptures
            sky.ts       day/night; the sun is the ONLY shadow-casting light
  player/   controller.ts Rapier kinematic capsule + spring-arm camera w/ raycast pullback
  cafe/     menu.ts      typed loader; strips any price off an unverified item defensively
            board.ts     menu board CanvasTexture + receipt PNG renderer
            ordering.ts  trigger volume, cart overlay, barista, tray spawn
  ui/       stats.ts     hand-rolled FPS/frame-time/heap readout
            minimap.ts   ortho render-to-texture at 6 Hz (not per frame)
scripts/    fetch-commons.mjs  fetch-menu.mjs  fetch-textures.mjs
```

### Hidden failure modes handled

1. **Rapier WASM race** — `Physics.create()` is the only constructor and awaits
   `RAPIER.init()` before touching `World` or any `ColliderDesc`.
2. **Instanced vines killing fps** — hard instance cap per preset, rows culled beyond
   `vineDistance`, `castShadow = false` on every vine mesh.
3. **Texture RAM blowup** — 1K only; textures and materials cached by key; packed `arm`
   maps (AO+Rough+Metal in one RGB texture) instead of 3 separate uploads.
4. **Commons API rate limit** — single 3 s backoff then continue (it *did* return 429
   mid-run; the backoff recovered and still got 20 images).
5. **Menu not machine-readable** — handled as described above; no OCR guessing.
6. **Camera clipping through walls** — raycast from player pivot to the desired camera
   position, arm pulled in on hit, smoothed asymmetrically (fast in, slow out).
7. **Falling through terrain at spawn** — spawn 2 m above ground; `physics.step()` runs
   once with gravity disabled, *then* `player.enableGravity()`.
8. **SSAO on an iGPU** — off on Low **and** Medium; only F3/High enables it.
9. **Copyright** — see "Deliberately excluded".

---

## Budgets

Run the app and press **P**, or read the table auto-logged after ~2 seconds.

| Budget | Limit | Measured |
|---|---|---|
| Total download | 120 MB | **18 MB** (2.7 MB JS + 14 MB textures + 1.4 MB HDRI) |
| GPU texture memory | 150 MB | **~112 MB** (21 × 1K maps incl. mip chains) |
| npm dependencies | 5 locked | **5** (three, rapier3d-compat, postprocessing, vite, typescript) |
| 4K textures | none | **none** — 1K only |
| Shadow-casting lights | 1 | **1** (the sun) |

`renderer.info` reports live triangle and draw-call counts in the HUD.
