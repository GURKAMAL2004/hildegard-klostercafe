import * as THREE from 'three';
import { EUR, type Menu } from './menu';

/**
 * Renders menu.json onto a CanvasTexture used as the in-cafe menu board.
 * Unverified items are drawn with a warning glyph and "Preis vor Ort" rather
 * than any invented number.
 */
export function buildMenuBoard(menu: Menu): { mesh: THREE.Mesh; texture: THREE.CanvasTexture } {
  const W = 1024, H = 1448;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d')!;

  // Chalkboard ground.
  const grad = x.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#22282c');
  grad.addColorStop(1, '#171b1e');
  x.fillStyle = grad;
  x.fillRect(0, 0, W, H);
  x.strokeStyle = '#6b5436';
  x.lineWidth = 16;
  x.strokeRect(8, 8, W - 16, H - 16);

  let y = 86;
  x.textAlign = 'center';
  x.fillStyle = '#e8d5a8';
  x.font = '600 52px Georgia, serif';
  x.fillText('Klostercafé', W / 2, y); y += 52;
  x.font = '600 40px Georgia, serif';
  x.fillText('St. Hildegard', W / 2, y); y += 40;
  x.font = 'italic 24px Georgia, serif';
  x.fillStyle = '#b9ab8c';
  x.fillText('Selbstbedienung · Inklusionsbetrieb', W / 2, y); y += 44;

  x.strokeStyle = '#6b5436';
  x.lineWidth = 2;
  x.beginPath(); x.moveTo(60, y); x.lineTo(W - 60, y); x.stroke();
  y += 40;

  x.textAlign = 'left';
  for (const cat of menu.categories) {
    if (y > H - 160) break;
    x.fillStyle = '#e8d5a8';
    x.font = '600 32px Georgia, serif';
    x.fillText(cat.name.toUpperCase(), 58, y);
    y += 36;

    for (const it of cat.items) {
      if (y > H - 130) break;
      const warn = !it.verified;
      x.font = '25px "Segoe UI", system-ui, sans-serif';
      x.fillStyle = warn ? '#9aa0a6' : '#f2e9d8';
      const label = (warn ? '⚠ ' : '') + it.name;
      x.fillText(label.length > 40 ? label.slice(0, 39) + '…' : label, 76, y);

      x.textAlign = 'right';
      if (it.price != null && it.verified) {
        x.fillStyle = '#e8d5a8';
        x.font = '600 25px "Segoe UI", system-ui, sans-serif';
        x.fillText(EUR(it.price), W - 66, y);
      } else {
        x.fillStyle = '#7f858b';
        x.font = 'italic 21px "Segoe UI", system-ui, sans-serif';
        x.fillText('Preis vor Ort', W - 66, y);
      }
      x.textAlign = 'left';
      y += 31;

      if (it.desc) {
        x.fillStyle = '#878d93';
        x.font = 'italic 18px "Segoe UI", system-ui, sans-serif';
        const d = it.desc.length > 58 ? it.desc.slice(0, 57) + '…' : it.desc;
        x.fillText(d, 92, y);
        y += 24;
      }
    }
    y += 16;
  }

  // Footer: where the real prices live.
  x.textAlign = 'center';
  x.fillStyle = '#8f857a';
  x.font = '18px "Segoe UI", system-ui, sans-serif';
  x.fillText('⚠ = Preis nicht aus offizieller Quelle bestätigt', W / 2, H - 92);
  x.font = '17px "Segoe UI", system-ui, sans-serif';
  x.fillText('Vollständige Speisekarte 2026 als PDF auf', W / 2, H - 66);
  x.fillStyle = '#b9ab8c';
  x.fillText('klostercafe.abtei-st-hildegard.de', W / 2, H - 42);

  const texture = new THREE.CanvasTexture(cv);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 2.12),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.92, metalness: 0 }),
  );
  mesh.name = 'menu-board';
  return { mesh, texture };
}

export interface Receipt {
  orderNo: string;
  when: Date;
  lines: { name: string; qty: number; price: number | null }[];
  total: number;
  pricedOnSite: number;
}

/** Draw the receipt to a canvas so it can be shown and downloaded as PNG. */
export function renderReceipt(menu: Menu, r: Receipt): HTMLCanvasElement {
  const W = 520;
  const H = 300 + r.lines.length * 46 + (r.pricedOnSite ? 40 : 0);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d')!;

  x.fillStyle = '#fbf7ee';
  x.fillRect(0, 0, W, H);
  x.strokeStyle = '#d8cdb4';
  x.lineWidth = 2;
  x.strokeRect(10, 10, W - 20, H - 20);

  let y = 56;
  x.textAlign = 'center';
  x.fillStyle = '#2a1d12';
  x.font = '600 26px Georgia, serif';
  x.fillText(menu.name, W / 2, y); y += 28;
  x.font = '14px "Segoe UI", system-ui, sans-serif';
  x.fillStyle = '#5c5146';
  for (const part of menu.address.split(', ')) { x.fillText(part, W / 2, y); y += 19; }
  y += 6;
  x.font = 'italic 13px "Segoe UI", system-ui, sans-serif';
  x.fillText('Selbstbedienung · Simulierte Bestellung', W / 2, y); y += 26;

  x.strokeStyle = '#ccc0a6';
  x.beginPath(); x.moveTo(32, y); x.lineTo(W - 32, y); x.stroke(); y += 28;

  x.textAlign = 'left';
  x.font = '13px ui-monospace, Consolas, monospace';
  x.fillStyle = '#5c5146';
  x.fillText(`Bestell-Nr.  ${r.orderNo}`, 36, y); y += 20;
  x.fillText(`Datum       ${r.when.toLocaleString('de-DE')}`, 36, y); y += 26;

  x.strokeStyle = '#ccc0a6';
  x.beginPath(); x.moveTo(32, y); x.lineTo(W - 32, y); x.stroke(); y += 30;

  for (const l of r.lines) {
    x.fillStyle = '#2a1d12';
    x.font = '15px "Segoe UI", system-ui, sans-serif';
    const nm = `${l.qty}×  ${l.name}`;
    x.fillText(nm.length > 34 ? nm.slice(0, 33) + '…' : nm, 36, y);
    x.textAlign = 'right';
    if (l.price != null) {
      x.font = '600 15px "Segoe UI", system-ui, sans-serif';
      x.fillText(EUR(l.price * l.qty), W - 36, y);
    } else {
      x.font = 'italic 13px "Segoe UI", system-ui, sans-serif';
      x.fillStyle = '#8a7f72';
      x.fillText('Preis vor Ort', W - 36, y);
    }
    x.textAlign = 'left';
    y += 46 - 20;
    y += 20;
  }

  y += 6;
  x.strokeStyle = '#2a1d12';
  x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(32, y); x.lineTo(W - 32, y); x.stroke(); y += 32;

  x.fillStyle = '#2a1d12';
  x.font = '600 19px "Segoe UI", system-ui, sans-serif';
  x.fillText('Summe (bestätigt)', 36, y);
  x.textAlign = 'right';
  x.fillText(EUR(r.total), W - 36, y);
  x.textAlign = 'left';
  y += 28;

  if (r.pricedOnSite > 0) {
    x.font = 'italic 14px "Segoe UI", system-ui, sans-serif';
    x.fillStyle = '#8a6a2a';
    x.fillText(`+ ${r.pricedOnSite} Position(en) nur vor Ort bepreist`, 36, y);
    y += 24;
  }

  x.textAlign = 'center';
  x.font = '12px "Segoe UI", system-ui, sans-serif';
  x.fillStyle = '#8a7f72';
  x.fillText('Keine echte Zahlung · In-Game-Simulation', W / 2, H - 30);

  return cv;
}
