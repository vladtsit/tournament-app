import type { HTMLAttributes, ReactNode } from "react";

export interface SectionTitleProps extends HTMLAttributes<HTMLDivElement> {
  trailing?: ReactNode;
}

/**
 * Small, uppercase, tracked-out section label. Use above lists and metric
 * groups to establish hierarchy without competing with screen titles.
 */
export function SectionTitle({
  trailing,
  children,
  style,
  ...rest
}: SectionTitleProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-2)",
        fontSize: "var(--font-xs)",
        fontWeight: "var(--weight-semibold)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--text-muted)",
        marginBottom: "var(--space-2)",
        ...style,
      }}
      {...rest}
    >
      <span>{children}</span>
      {trailing ? <span>{trailing}</span> : null}
    </div>
  );
}
