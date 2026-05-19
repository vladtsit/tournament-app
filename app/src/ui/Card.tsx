import { forwardRef, type HTMLAttributes } from "react";
import styles from "./Card.module.css";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "flat" | "elevated" | "hero";
  padding?: "sm" | "md" | "lg";
  interactive?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    variant = "elevated",
    padding = "md",
    interactive = false,
    className,
    children,
    ...rest
  },
  ref,
) {
  const classes = [
    styles["card"],
    styles[variant],
    styles[`pad${padding.charAt(0).toUpperCase()}${padding.slice(1)}`],
    interactive ? styles["interactive"] : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div ref={ref} className={classes} {...rest}>
      {children}
    </div>
  );
});
