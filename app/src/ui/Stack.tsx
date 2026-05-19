import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

const gapMap = {
  none: "0",
  xs: "var(--space-1)",
  sm: "var(--space-2)",
  md: "var(--space-3)",
  lg: "var(--space-4)",
  xl: "var(--space-5)",
  "2xl": "var(--space-6)",
} as const;

export type Gap = keyof typeof gapMap;

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  gap?: Gap;
  align?: CSSProperties["alignItems"];
  justify?: CSSProperties["justifyContent"];
  wrap?: boolean;
  children?: ReactNode;
}

/** Vertical flex container. */
export function Stack({
  gap = "md",
  align,
  justify,
  wrap = false,
  style,
  children,
  ...rest
}: StackProps) {
  const merged: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: gapMap[gap],
    alignItems: align,
    justifyContent: justify,
    flexWrap: wrap ? "wrap" : undefined,
    ...style,
  };
  return (
    <div style={merged} {...rest}>
      {children}
    </div>
  );
}

/** Horizontal flex container. */
export function Inline({
  gap = "sm",
  align = "center",
  justify,
  wrap = false,
  style,
  children,
  ...rest
}: StackProps) {
  const merged: CSSProperties = {
    display: "flex",
    flexDirection: "row",
    gap: gapMap[gap],
    alignItems: align,
    justifyContent: justify,
    flexWrap: wrap ? "wrap" : undefined,
    ...style,
  };
  return (
    <div style={merged} {...rest}>
      {children}
    </div>
  );
}
