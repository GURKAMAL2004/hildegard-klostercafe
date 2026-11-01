import * as THREE from 'three';
import type { Assets } from '../core/assets';
import { EUR, isOpen, type Menu, type MenuItem } from './menu';
import { renderReceipt, type Receipt } from './board';

const TRIGGER_RADIUS = 2.6;

interface CartLine { item: MenuItem; qty: number }

export class Ordering {
  private overlay: HTMLDivElement;
  private cart = new Map<string, CartLine>();
  private open = false;
  private orderSeq = 1;

  /** Barista + tray visuals. */
  private barista: THREE.Group;
  private baristaBase = new THREE.Vector3();
  private prepTimer = 0;
  private preparing = false;
  private pendingReceipt: Receipt | null = null;
  private trayParent: THREE.Group;
  private usedTables = new Set<number>();

  constructor(
    private menu: Menu,
    private assets: Assets,
    private scene: THREE.Scene,
    private counter: THREE.Vector3,
    private tables: THREE.Vector3[],
    baristaAt: THREE.Vector3,
    private promptEl: HTMLElement,
  ) {
    this.overlay = this.buildOverlay();
    document.body.appendChild(this.overlay);

    this.barista = this.buildBarista();
    this.baristaBase.copy(baristaAt);
    this.barista.position.copy(baristaAt);
    scene.add(this.barista);

    this.trayParent = new THREE.Group();
    scene.add(this.trayParent);

    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.open) this.close();
    });
  }

  // ------------------------------------------------------------- barista mesh
  private buildBarista(): THREE.Group {
    const g = new THREE.Group();
    const apron = this.assets.plain(0x7a6a52, 0.85);
    const skin = this.assets.plain(0xc8a07e, 0.75);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.4, 4, 8), apron);
    torso.position.y = 1.1;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), skin);
    head.position.y = 1.54;
    const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.32, 3, 6), skin);
    armL.position.set(-0.27, 1.14, 0);
    const armR = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.32, 3, 6), skin);
    armR.position.set(0.27, 1.14, 0);
    for (const o of [torso, head, armL, armR]) { o.castShadow = true; g.add(o); }
    g.userData.armL = armL;
    g.userData.armR = armR;
    g.rotation.y = Math.PI;
    return g;
  }

  // ------------------------------------------------------------- overlay DOM
  private buildOverlay(): HTMLDivElement {
    const el = document.createElement('div');
    el.id = 'order-overlay';
    el.style.cssText = `
      position:fixed; inset:0; z-index:60; display:none;
      background:rgba(8,10,13,.78); backdrop-filter:blur(3px);
      align-items:center; justify-content:center; padding:3vh 2vw;
      font-family:'Segoe UI',system-ui,sans-serif; color:#f2e9d8;`;
    el.innerHTML = `
      <div style="display:flex;gap:16px;width:min(1060px,96vw);max-height:94vh">
        <div style="flex:1 1 60%;background:#1a1f25;border:1px solid rgba(232,213,168,.2);
                    border-radius:12px;overflow:hidden;display:flex;flex-direction:column">
          <div style="padding:16px 20px;border-bottom:1px solid rgba(232,213,168,.14)">
            <div style="font:600 21px Georgia,serif;color:#e8d5a8">Klostercafé St. Hildegard</div>
            <div id="ord-sub" style="font-size:12.5px;opacity:.6;margin-top:3px"></div>
          </div>
          <div id="ord-cats" style="overflow-y:auto;padding:6px 8px 14px"></div>
        </div>
        <div style="flex:0 0 310px;background:#1a1f25;border:1px solid rgba(232,213,168,.2);
                    border-radius:12px;display:flex;flex-direction:column">
          <div style="padding:15px 18px;border-bottom:1px solid rgba(232,213,168,.14);
                      font:600 16px 'Segoe UI'">Bestellung</div>
          <div id="ord-cart" style="flex:1;overflow-y:auto;padding:10px 14px;font-size:13.5px"></div>
          <div style="padding:14px 18px;border-top:1px solid rgba(232,213,168,.14)">
            <div id="ord-total" style="font:600 18px 'Segoe UI';margin-bottom:4px"></div>
            <div id="ord-note" style="font-size:11.5px;color:#c8a85a;margin-bottom:11px"></div>
            <button id="ord-place" style="width:100%;padding:11px;border:0;border-radius:7px;
              background:#e8d5a8;color:#2a1d12;font:600 15px 'Segoe UI';cursor:pointer">
              Bestellung aufgeben</button>
            <button id="ord-close" style="width:100%;padding:9px;margin-top:7px;border:0;
              border-radius:7px;background:transparent;color:#9aa0a6;font-size:13px;cursor:pointer">
              Schließen (Esc)</button>
          </div>
        </div>
      </div>`;
    el.querySelector<HTMLButtonElement>('#ord-close')!.onclick = () => this.close();
    el.querySelector<HTMLButtonElement>('#ord-place')!.onclick = () => this.place();
    return el;
  }

  private key(i: MenuItem) { return i.name.toLowerCase(); }

  private renderCats() {
    const host = this.overlay.querySelector<HTMLDivElement>('#ord-cats')!;
    host.innerHTML = '';
    for (const cat of this.menu.categories) {
      const h = document.createElement('div');
      h.textContent = cat.name;
      h.style.cssText = `font:600 13px 'Segoe UI';letter-spacing:.9px;text-transform:uppercase;
        color:#b9ab8c;padding:14px 12px 7px`;
      host.appendChild(h);

      for (const it of cat.items) {
        const row = document.createElement('div');
        row.style.cssText = `display:flex;align-items:center;gap:10px;padding:8px 12px;
          border-radius:7px;`;
        row.onmouseenter = () => (row.style.background = 'rgba(255,255,255,.04)');
        row.onmouseleave = () => (row.style.background = 'transparent');

        const warn = !it.verified;
        const info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0';
        info.innerHTML =
          `<div style="font-size:14.5px;${warn ? 'color:#c9cdd2' : ''}">` +
          (warn ? '<span title="Preis nicht bestätigt" style="color:#e0b84a">⚠ </span>' : '') +
          this.esc(it.name) + '</div>' +
          (it.desc ? `<div style="font-size:11.5px;opacity:.5;margin-top:2px">${this.esc(it.desc)}</div>` : '');

        const price = document.createElement('div');
        price.style.cssText = 'flex:0 0 96px;text-align:right;font-size:13.5px';
        price.innerHTML = it.price != null && it.verified
          ? `<b>${EUR(it.price)}</b>`
          : `<span style="font-style:italic;opacity:.55;font-size:11.5px">Preis vor Ort</span>`;

        const qtyBox = document.createElement('div');
        qtyBox.style.cssText = 'flex:0 0 86px;display:flex;align-items:center;gap:6px;justify-content:flex-end';
        const mk = (txt: string, fn: () => void) => {
          const b = document.createElement('button');
          b.textContent = txt;
          b.style.cssText = `width:25px;height:25px;border:1px solid rgba(232,213,168,.3);
            background:transparent;color:#f2e9d8;border-radius:5px;cursor:pointer;font-size:15px;
            line-height:1;display:grid;place-items:center`;
          b.onclick = fn;
          return b;
        };
        const num = document.createElement('span');
        num.style.cssText = 'min-width:15px;text-align:center;font-variant-numeric:tabular-nums';
        const sync = () => { num.textContent = String(this.cart.get(this.key(it))?.qty ?? 0); };
        qtyBox.append(
          mk('–', () => { this.dec(it); sync(); this.renderCart(); }),
          num,
          mk('+', () => { this.inc(it); sync(); this.renderCart(); }),
        );
        sync();

        row.append(info, price, qtyBox);
        host.appendChild(row);
      }
    }
  }

  private esc(s: string) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  }

  private inc(it: MenuItem) {
    const k = this.key(it);
    const l = this.cart.get(k);
    if (l) l.qty++;
    else this.cart.set(k, { item: it, qty: 1 });
  }
  private dec(it: MenuItem) {
    const k = this.key(it);
    const l = this.cart.get(k);
    if (!l) return;
    l.qty--;
    if (l.qty <= 0) this.cart.delete(k);
  }

  private totals() {
    let total = 0, pricedOnSite = 0, items = 0;
    for (const l of this.cart.values()) {
      items += l.qty;
      if (l.item.price != null && l.item.verified) total += l.item.price * l.qty;
      else pricedOnSite += l.qty;
    }
    return { total, pricedOnSite, items };
  }

  private renderCart() {
    const host = this.overlay.querySelector<HTMLDivElement>('#ord-cart')!;
    const { total, pricedOnSite, items } = this.totals();
    if (!items) {
      host.innerHTML = `<div style="opacity:.45;padding:14px 2px;font-size:13px">
        Noch nichts ausgewählt.</div>`;
    } else {
      host.innerHTML = [...this.cart.values()].map((l) => {
        const right = l.item.price != null && l.item.verified
          ? EUR(l.item.price * l.qty)
          : '<i style="opacity:.55;font-size:11.5px">vor Ort</i>';
        return `<div style="display:flex;gap:8px;padding:5px 0">
          <span style="flex:0 0 22px;opacity:.6">${l.qty}×</span>
          <span style="flex:1;min-width:0">${!l.item.verified ? '⚠ ' : ''}${this.esc(l.item.name)}</span>
          <span style="flex:0 0 72px;text-align:right">${right}</span></div>`;
      }).join('');
    }
    this.overlay.querySelector('#ord-total')!.textContent = `Summe  ${EUR(total)}`;
    const note = this.overlay.querySelector<HTMLElement>('#ord-note')!;
    note.textContent = pricedOnSite
      ? `+ ${pricedOnSite} Position(en) nur vor Ort bepreist ⚠`
      : '';
    const btn = this.overlay.querySelector<HTMLButtonElement>('#ord-place')!;
    btn.disabled = items === 0;
    btn.style.opacity = items === 0 ? '0.45' : '1';
    btn.style.cursor = items === 0 ? 'default' : 'pointer';
  }

  // ------------------------------------------------------------- open / close
  openOverlay(gameHour: number, dayIndex: number) {
    const { open, row } = isOpen(this.menu, gameHour, dayIndex);
    const sub = this.overlay.querySelector<HTMLElement>('#ord-sub')!;
    const hrs = row.closed ? 'heute geschlossen' : `${row.open}–${row.close}`;
    sub.innerHTML =
      `Selbstbedienung · ${hrs} ${row.verified ? '' : '⚠ Zeiten unbestätigt'} · ` +
      `Quelle: <span style="opacity:.8">${this.esc(new URL(this.menu.source_url).hostname)}</span>`;
    this.renderCats();
    this.renderCart();
    this.overlay.style.display = 'flex';
    this.open = true;
    document.exitPointerLock?.();
  }
  close() {
    this.overlay.style.display = 'none';
    this.open = false;
  }
  get isOpenUI() { return this.open; }

  // ------------------------------------------------------------- place order
  private place() {
    const { total, pricedOnSite, items } = this.totals();
    if (!items) return;
    const receipt: Receipt = {
      orderNo: 'KC-' + String(Date.now()).slice(-6) + '-' + this.orderSeq++,
      when: new Date(),
      lines: [...this.cart.values()].map((l) => ({
        name: l.item.name,
        qty: l.qty,
        price: l.item.verified ? l.item.price : null,
      })),
      total,
      pricedOnSite,
    };
    this.pendingReceipt = receipt;
    this.preparing = true;
    this.prepTimer = 0;
    this.cart.clear();
    this.close();
    this.promptEl.style.display = 'block';
    this.promptEl.innerHTML = 'Wird vorbereitet…';
  }

  /** Called every frame. Drives the 3 s "preparing" animation and tray spawn. */
  update(dt: number, playerPos: THREE.Vector3, gameHour: number, dayIndex: number, nearPrompt: boolean) {
    // Barista idle + prep animation.
    const t = performance.now() / 1000;
    const armL = this.barista.userData.armL as THREE.Mesh;
    const armR = this.barista.userData.armR as THREE.Mesh;

    if (this.preparing) {
      this.prepTimer += dt;
      // Busy hands.
      armL.rotation.x = Math.sin(t * 11) * 0.9 - 0.4;
      armR.rotation.x = Math.cos(t * 13) * 0.9 - 0.4;
      this.barista.position.x = this.baristaBase.x + Math.sin(t * 2.4) * 0.35;

      if (this.prepTimer >= 3.0) {
        this.preparing = false;
        armL.rotation.x = armR.rotation.x = 0;
        this.barista.position.copy(this.baristaBase);
        if (this.pendingReceipt) {
          this.spawnTray(this.pendingReceipt, playerPos);
          this.showReceipt(this.pendingReceipt);
          this.pendingReceipt = null;
        }
      }
      return;
    }

    armL.rotation.x = Math.sin(t * 1.3) * 0.07;
    armR.rotation.x = -Math.sin(t * 1.3) * 0.07;

    // Counter prompt.
    const d = playerPos.distanceTo(this.counter);
    if (nearPrompt && d < TRIGGER_RADIUS && !this.open) {
      const { open } = isOpen(this.menu, gameHour, dayIndex);
      this.promptEl.style.display = 'block';
      this.promptEl.innerHTML = open
        ? 'Drücke <kbd>E</kbd> um zu bestellen'
        : '<span style="color:#e0b84a">Geschlossen / Closed</span> — ' +
          `${this.menu.hours.find((h) => h.closed) ? 'Montag Ruhetag' : ''} 09:30–17:30`;
    } else if (!this.open && this.promptEl.innerHTML.includes('bestellen')) {
      this.promptEl.style.display = 'none';
    }
  }

  canOrder(playerPos: THREE.Vector3, gameHour: number, dayIndex: number): boolean {
    if (playerPos.distanceTo(this.counter) >= TRIGGER_RADIUS) return false;
    return isOpen(this.menu, gameHour, dayIndex).open;
  }

  nearCounter(playerPos: THREE.Vector3) {
    return playerPos.distanceTo(this.counter) < TRIGGER_RADIUS;
  }

  /** Put a tray with cups/plates on the nearest free table. */
  private spawnTray(r: Receipt, playerPos: THREE.Vector3) {
    let bestI = -1, bestD = Infinity;
    for (let i = 0; i < this.tables.length; i++) {
      if (this.usedTables.has(i)) continue;
      const d = this.tables[i].distanceTo(playerPos);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestI < 0) { this.usedTables.clear(); bestI = 0; }
    this.usedTables.add(bestI);
    const at = this.tables[bestI];

    const tray = new THREE.Group();
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.025, 0.34),
      this.assets.plain(0x6b4a2f, 0.7),
    );
    board.castShadow = true;
    tray.add(board);

    const totalQty = r.lines.reduce((a, l) => a + l.qty, 0);
    const n = Math.min(4, Math.max(1, totalQty));
    for (let i = 0; i < n; i++) {
      const isDrink = /kaffee|tee|kakao|wein|secco|wasser|bier|schorle|limonade|saft/i.test(
        r.lines[i % r.lines.length].name,
      );
      const ox = -0.13 + (i % 2) * 0.26;
      const oz = -0.08 + Math.floor(i / 2) * 0.16;
      if (isDrink) {
        const cup = new THREE.Mesh(
          new THREE.CylinderGeometry(0.038, 0.032, 0.085, 10),
          this.assets.plain(0xf4efe4, 0.4),
        );
        cup.position.set(ox, 0.055, oz);
        cup.castShadow = true;
        tray.add(cup);
        const brew = new THREE.Mesh(
          new THREE.CylinderGeometry(0.034, 0.034, 0.008, 10),
          this.assets.plain(0x40200f, 0.3),
        );
        brew.position.set(ox, 0.094, oz);
        tray.add(brew);
      } else {
        const plate = new THREE.Mesh(
          new THREE.CylinderGeometry(0.072, 0.066, 0.012, 12),
          this.assets.plain(0xf4efe4, 0.35),
        );
        plate.position.set(ox, 0.019, oz);
        plate.castShadow = true;
        tray.add(plate);
        const cake = new THREE.Mesh(
          new THREE.CylinderGeometry(0.044, 0.05, 0.045, 10, 1, false, 0, Math.PI * 1.5),
          this.assets.plain(0xd9a05b, 0.65),
        );
        cake.position.set(ox, 0.047, oz);
        cake.castShadow = true;
        tray.add(cake);
      }
    }
    tray.position.copy(at);
    this.trayParent.add(tray);
  }

  // ------------------------------------------------------------- receipt UI
  private showReceipt(r: Receipt) {
    const cv = renderReceipt(this.menu, r);
    const wrap = document.createElement('div');
    wrap.style.cssText = `position:fixed;inset:0;z-index:70;display:flex;align-items:center;
      justify-content:center;background:rgba(8,10,13,.8);backdrop-filter:blur(3px);
      font-family:'Segoe UI',system-ui,sans-serif`;
    const col = document.createElement('div');
    col.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:13px';
    cv.style.cssText = 'max-height:72vh;border-radius:9px;box-shadow:0 14px 50px rgba(0,0,0,.6)';
    col.appendChild(cv);

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:9px';
    const mkBtn = (label: string, primary: boolean) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = `padding:10px 20px;border:0;border-radius:7px;cursor:pointer;
        font:600 14px 'Segoe UI';${primary
          ? 'background:#e8d5a8;color:#2a1d12'
          : 'background:rgba(255,255,255,.1);color:#f2e9d8'}`;
      return b;
    };
    const dl = mkBtn('Beleg als PNG speichern', true);
    dl.onclick = () => {
      const a = document.createElement('a');
      a.download = `klostercafe-beleg-${r.orderNo}.png`;
      a.href = cv.toDataURL('image/png');
      a.click();
    };
    const cl = mkBtn('Weiter', false);
    cl.onclick = () => {
      wrap.remove();
      this.promptEl.style.display = 'none';
    };
    bar.append(dl, cl);
    col.appendChild(bar);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:11.5px;opacity:.5;color:#f2e9d8';
    hint.textContent = 'Simulierte Bestellung — keine echte Zahlung, kein Versand an das Café.';
    col.appendChild(hint);

    wrap.appendChild(col);
    document.body.appendChild(wrap);
  }
}
