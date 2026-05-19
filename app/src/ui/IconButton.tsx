import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import styles from "./IconButton.module.css";

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required for accessibility — icon-only buttons need a label. */
  "aria-label": string;
  icon: ReactNode;
  size?: "sm" | "md" | "lg";
  variant?: "outline" | "flat" | "accent";
  /** Apply a continuous spin animation to the icon (e.g. while refreshing). */
  spinning?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      icon,
      size = "md",
      variant = "outline",
      spinning = false,
      className,
      type = "button",
      ...rest
    },
    ref,
  ) {
    const classes = [
      styles["iconBtn"],
      styles[size],
      variant === "flat" ? styles["flat"] : null,
      variant === "accent" ? styles["accent"] : null,
      className,
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <button ref={ref} type={type} className={classes} {...rest}>
        <span
          className={spinning ? styles["spin"] : undefined}
          aria-hidden="true"
          style={{ display: "inline-flex" }}
        >
          {icon}
        </span>
      </button>
    );
  },
);
