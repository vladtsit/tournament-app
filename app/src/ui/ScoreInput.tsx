import { useCallback } from "react";
import { Minus, Plus } from "lucide-react";
import styles from "./ScoreInput.module.css";

export interface ScoreInputProps {
  value: number | "";
  onChange: (value: number | "") => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  "aria-label"?: string;
}

/**
 * Single-number stepper with large numerals + tap-friendly +/- buttons.
 * Useful for a pádel set score (0-9). Pair two of them around a separator for
 * an "a vs b" set entry.
 */
export function ScoreInput({
  value,
  onChange,
  min = 0,
  max = 9,
  disabled = false,
  "aria-label": ariaLabel,
}: ScoreInputProps) {
  const current = typeof value === "number" ? value : 0;
  const inc = useCallback(() => {
    if (disabled) return;
    onChange(Math.min(max, current + 1));
  }, [current, disabled, max, onChange]);
  const dec = useCallback(() => {
    if (disabled) return;
    onChange(Math.max(min, current - 1));
  }, [current, disabled, min, onChange]);
  return (
    <div className={styles["wrap"]} aria-label={ariaLabel}>
      <button
        type="button"
        className={styles["btn"]}
        onClick={dec}
        disabled={disabled || current <= min}
        aria-label="decrease"
      >
        <Minus size={18} />
      </button>
      <span className={styles["value"]}>
        {typeof value === "number" ? value : "–"}
      </span>
      <button
        type="button"
        className={styles["btn"]}
        onClick={inc}
        disabled={disabled || current >= max}
        aria-label="increase"
      >
        <Plus size={18} />
      </button>
    </div>
  );
}

export interface SetScoreInputProps {
  a: number | "";
  b: number | "";
  onChangeA: (v: number | "") => void;
  onChangeB: (v: number | "") => void;
  disabled?: boolean;
  labelA?: string;
  labelB?: string;
  max?: number;
}

/** Two ScoreInputs with a `:` separator — represents one tennis set. */
export function SetScoreInput({
  a,
  b,
  onChangeA,
  onChangeB,
  disabled,
  labelA,
  labelB,
  max,
}: SetScoreInputProps) {
  return (
    <div className={styles["set"]}>
      <ScoreInput
        value={a}
        onChange={onChangeA}
        {...(disabled !== undefined ? { disabled } : {})}
        {...(max !== undefined ? { max } : {})}
        {...(labelA !== undefined ? { "aria-label": labelA } : {})}
      />
      <span className={styles["separator"]} aria-hidden="true">
        :
      </span>
      <ScoreInput
        value={b}
        onChange={onChangeB}
        {...(disabled !== undefined ? { disabled } : {})}
        {...(max !== undefined ? { max } : {})}
        {...(labelB !== undefined ? { "aria-label": labelB } : {})}
      />
    </div>
  );
}
