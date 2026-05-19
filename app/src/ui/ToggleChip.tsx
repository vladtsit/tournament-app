import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Check } from "lucide-react";
import styles from "./ToggleChip.module.css";

export interface ToggleChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  checked: boolean;
  icon?: ReactNode;
  /** Visual tone when checked. Defaults to accent. */
  tone?: "accent" | "success" | "warning";
}

export function ToggleChip({
  checked,
  icon,
  tone = "accent",
  className,
  children,
  type = "button",
  ...rest
}: ToggleChipProps) {
  const checkedClass =
    tone === "success"
      ? styles["checkedSuccess"]
      : tone === "warning"
        ? styles["checkedWarning"]
        : styles["checked"];
  const classes = [styles["chip"], checked ? checkedClass : null, className]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type={type}
      role="switch"
      aria-checked={checked}
      className={classes}
      {...rest}
    >
      {checked ? (
        <span className={styles["icon"]} aria-hidden="true">
          <Check size={16} strokeWidth={3} />
        </span>
      ) : icon ? (
        <span className={styles["icon"]} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
    </button>
  );
}
