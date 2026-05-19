import { tintFor } from "./tint";

export interface AvatarProps {
  /** Stable identifier used to pick a consistent color. */
  id: string | number;
  /** Display name — first letters of first two words used as initials. */
  name: string;
  size?: number;
  title?: string;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    const p = parts[0] ?? "?";
    return p.slice(0, 2).toUpperCase();
  }
  const first = parts[0] ?? "";
  const last = parts[parts.length - 1] ?? "";
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

export function Avatar({ id, name, size = 36, title }: AvatarProps) {
  const tint = tintFor(id);
  return (
    <span
      title={title ?? name}
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        background: tint.bg,
        color: tint.fg,
        fontWeight: 700,
        fontSize: Math.round(size * 0.42),
        flex: "0 0 auto",
        border: `1px solid ${tint.border}`,
        userSelect: "none",
      }}
    >
      {initialsOf(name)}
    </span>
  );
}
