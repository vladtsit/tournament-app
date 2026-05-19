import type { HTMLAttributes } from "react";
import styles from "./Badge.module.css";

export type BadgeVariant =
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "neutral"
  | "gold"
  | "silver"
  | "bronze";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: "sm" | "md";
  dot?: boolean;
}

export function Badge({
  variant = "neutral",
  size = "sm",
  dot = false,
  className,
  children,
  ...rest
}: BadgeProps) {
  const classes = [styles["badge"], styles[size], styles[variant], className]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} {...rest}>
      {dot ? <span className={styles["dot"]} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
