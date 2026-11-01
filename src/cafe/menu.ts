export interface MenuItem {
  name: string;
  desc: string;
  price: number | null;
  verified: boolean;
}
export interface MenuCategory {
  name: string;
  source?: string;
  items: MenuItem[];
}
export interface HoursRow {
  day: string;
  open: string | null;
  close: string | null;
  closed: boolean;
  verified: boolean;
  source?: string;
}
export interface Menu {
  name: string;
  address: string;
  source_url: string;
  vanity_url?: string;
  speisekarte_pdf?: string;
  speisekarte_images?: string[];
  fetched_at: string;
  currency: string;
  service: string;
  facts: string[];
  notes: string[];
  hours: HoursRow[];
  categories: MenuCategory[];
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function loadMenu(): Promise<Menu> {
  const r = await fetch('data/menu.json');
  if (!r.ok) throw new Error('data/menu.json missing - run: npm run fetch:menu');
  const m: Menu = await r.json();
  // Defensive: the UI must never show a price on an unverified item, even if the
  // data file were hand-edited later.
  for (const c of m.categories) {
    for (const it of c.items) if (!it.verified) it.price = null;
  }
  return m;
}

export function counts(m: Menu) {
  const all = m.categories.flatMap((c) => c.items);
  const verified = all.filter((i) => i.verified).length;
  return { total: all.length, verified, unverified: all.length - verified };
}

/** Is the cafe open at the given in-game time? */
export function isOpen(m: Menu, gameHour: number, dayIndex: number): { open: boolean; row: HoursRow } {
  const row = m.hours.find((h) => h.day === DAYS[dayIndex % 7]) ?? m.hours[0];
  if (row.closed || !row.open || !row.close) return { open: false, row };
  const toH = (s: string) => {
    const [a, b] = s.split(':').map(Number);
    return a + b / 60;
  };
  const o = toH(row.open), c = toH(row.close);
  return { open: gameHour >= o && gameHour < c, row };
}

export function hoursSummary(m: Menu): string {
  return m.hours
    .map((h) => `${h.day} ${h.closed ? 'geschlossen' : `${h.open}-${h.close}`}`)
    .join(' · ');
}

export const EUR = (n: number) => n.toFixed(2).replace('.', ',') + ' €';
