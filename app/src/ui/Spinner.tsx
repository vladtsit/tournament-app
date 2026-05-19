import type { CSSProperties } from "react";

export interface SpinnerProps {
  size?: number;
  color?: string;
  label?: string;
}

const styles: CSSProperties = {
  display: "inline-block",
  border: "2px solid currentColor",
  borderRightColor: "transparent",
  borderRadius: "50%",
  animation: "uiSpin 0.7s linear infinite",
};

// Inject keyframes once. Module-side effect is fine — same as Telegram's WebApp
// script init.
if (
  typeof document !== "undefined" &&
  !document.getElementById("ui-spinner-kf")
) {
  const el = document.createElement("style");
  el.id = "ui-spinner-kf";
  el.textContent = "@keyframes uiSpin { to { transform: rotate(360deg); } }";
  document.head.appendChild(el);
}

export function Spinner({ size = 20, color, label }: SpinnerProps) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      style={{
        ...styles,
        width: size,
        height: size,
        color: color ?? "var(--accent)",
      }}
    />
  );
}
