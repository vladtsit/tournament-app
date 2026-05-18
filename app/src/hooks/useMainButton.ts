import { useEffect } from "react";
import { getWebApp } from "../telegram";

interface Options {
  visible: boolean;
  text: string;
  enabled?: boolean;
  showProgress?: boolean;
  onClick: () => void;
}

/**
 * Drive the Telegram MainButton from a component. Safe no-op outside Telegram.
 * The button is hidden automatically when the host component unmounts.
 */
export function useMainButton({
  visible,
  text,
  enabled = true,
  showProgress = false,
  onClick,
}: Options): void {
  useEffect(() => {
    const wa = getWebApp();
    const btn = wa?.MainButton;
    if (!btn) return;
    if (!visible) {
      btn.hide();
      return;
    }
    btn.setText(text);
    if (enabled) btn.enable();
    else btn.disable();
    if (showProgress) btn.showProgress(false);
    else btn.hideProgress();
    btn.onClick(onClick);
    btn.show();
    return () => {
      btn.offClick(onClick);
      btn.hide();
      btn.hideProgress();
    };
  }, [visible, text, enabled, showProgress, onClick]);
}
