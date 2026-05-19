import { useEffect, useRef, useState } from "react";
import { Check, Languages } from "lucide-react";
import { IconButton } from "./IconButton";
import styles from "./LanguagePicker.module.css";

export interface LanguageOption<T extends string = string> {
  value: T;
  label: string;
}

export interface LanguagePickerProps<T extends string = string> {
  current: T;
  options: ReadonlyArray<LanguageOption<T>>;
  onSelect: (value: T) => void;
  label?: string;
}

export function LanguagePicker<T extends string>({
  current,
  options,
  onSelect,
  label = "Language",
}: LanguagePickerProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={styles["wrap"]}>
      <IconButton
        icon={<Languages size={18} />}
        aria-label={label}
        size="sm"
        variant="flat"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      />
      {open ? (
        <div role="menu" className={styles["menu"]}>
          {options.map((opt) => {
            const isActive = opt.value === current;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                className={[
                  styles["item"],
                  isActive ? styles["active"] : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  onSelect(opt.value);
                  setOpen(false);
                }}
              >
                <span>{opt.label}</span>
                {isActive ? <Check size={16} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
