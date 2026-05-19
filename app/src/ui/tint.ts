// Deterministic accent tint for avatars/cards based on a stable id (e.g. userId).
// Picks a hue from a small curated palette so colors look intentional rather
// than the noise of full hashing.

const palette = [
  { hue: 142, sat: 55 }, // padel-green
  { hue: 199, sat: 65 }, // sky
  { hue: 262, sat: 60 }, // violet
  { hue: 24, sat: 70 }, // clay-orange
  { hue: 340, sat: 60 }, // pink
  { hue: 47, sat: 70 }, // yellow
  { hue: 174, sat: 55 }, // teal
  { hue: 222, sat: 60 }, // indigo
];

export interface Tint {
  bg: string;
  fg: string;
  border: string;
}

export function tintFor(id: string | number): Tint {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const slot = palette[h % palette.length];
  if (!slot) return { bg: "var(--surface-2)", fg: "var(--text)", border: "var(--border)" };
  return {
    bg: `hsl(${slot.hue} ${slot.sat}% 92%)`,
    fg: `hsl(${slot.hue} ${slot.sat}% 28%)`,
    border: `hsl(${slot.hue} ${slot.sat}% 70%)`,
  };
}
