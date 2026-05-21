import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { IconButton } from "./IconButton";
import styles from "./Modal.module.css";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  closeLabel?: string;
  /** Optional trailing element rendered on the right of the header. */
  trailing?: ReactNode;
  children: ReactNode;
}

/**
 * Bottom-sheet on mobile, centered dialog on tablets+. Closes on ESC or
 * backdrop tap. Locks body scroll while open and restores focus on close.
 */
export function Modal({
  open,
  onClose,
  title,
  closeLabel = "Close",
  trailing,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Body-scroll lock + initial focus: run on the rising edge of `open`
  // only. Depending on `onClose` here causes the dialog to steal focus from
  // whatever the user is typing in every time the parent re-renders.
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    queueMicrotask(() => dialogRef.current?.focus());
    return () => {
      document.body.style.overflow = prevOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  // ESC handler depends on the latest onClose, so keep it in its own effect.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={styles["backdrop"]}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={styles["dialog"]}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
      >
        <div className={styles["header"]}>
          <div className={styles["title"]}>{title}</div>
          <div style={{ display: "inline-flex", gap: "var(--space-2)" }}>
            {trailing}
            <IconButton
              icon={<X size={20} />}
              aria-label={closeLabel}
              variant="flat"
              onClick={onClose}
            />
          </div>
        </div>
        <div className={styles["body"]}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
