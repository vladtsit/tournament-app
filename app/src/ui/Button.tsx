import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import styles from "./Button.module.css";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "success";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

/**
 * Themed button used app-wide. Provide a single `children` label; pass icons
 * via `leftIcon` / `rightIcon`. `loading` disables the button and shows a
 * spinner while preserving its width.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      fullWidth = false,
      loading = false,
      leftIcon,
      rightIcon,
      disabled,
      className,
      children,
      type = "button",
      ...rest
    },
    ref,
  ) {
    const classes = [
      styles["btn"],
      styles[size],
      styles[variant],
      fullWidth ? styles["fullWidth"] : null,
      loading ? styles["btnLoading"] : null,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        ref={ref}
        type={type}
        className={classes}
        disabled={disabled || loading}
        {...rest}
      >
        <span
          className={[styles["label"], loading ? styles["loadingHidden"] : null]
            .filter(Boolean)
            .join(" ")}
          style={{ gap: "var(--space-2)" }}
        >
          {leftIcon ? (
            <span className={styles["icon"]} aria-hidden="true">
              {leftIcon}
            </span>
          ) : null}
          {children}
          {rightIcon ? (
            <span className={styles["icon"]} aria-hidden="true">
              {rightIcon}
            </span>
          ) : null}
        </span>
        {loading ? (
          <span className={styles["spinnerOverlay"]} aria-hidden="true">
            <span className={styles["spinner"]} />
          </span>
        ) : null}
      </button>
    );
  },
);
