import type { CSSProperties } from "react";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: CSSProperties;
}

if (typeof document !== "undefined" && !document.getElementById("ui-skel-kf")) {
  const el = document.createElement("style");
  el.id = "ui-skel-kf";
  el.textContent = `
@keyframes uiSkel {
  0% { background-position: -200px 0; }
  100% { background-position: calc(200px + 100%) 0; }
}`;
  document.head.appendChild(el);
}

export function Skeleton({
  width = "100%",
  height = 16,
  radius = "var(--radius-sm)",
  style,
}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width,
        height,
        borderRadius: radius,
        background:
          "linear-gradient(90deg, var(--surface-2) 0px, color-mix(in srgb, var(--surface-2) 60%, var(--border)) 60px, var(--surface-2) 120px)",
        backgroundSize: "200px 100%",
        animation: "uiSkel 1.2s linear infinite",
        ...style,
      }}
    />
  );
}
