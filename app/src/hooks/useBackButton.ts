import { useEffect } from "react";
import { getWebApp } from "../telegram";

/**
 * Show the Telegram BackButton while `visible` is true; invokes `onClick` when
 * pressed. Safe no-op outside Telegram.
 */
export function useBackButton(visible: boolean, onClick: () => void): void {
  useEffect(() => {
    const wa = getWebApp();
    const btn = wa?.BackButton;
    if (!btn) return;
    if (visible) {
      btn.onClick(onClick);
      btn.show();
      return () => {
        btn.offClick(onClick);
        btn.hide();
      };
    }
    return;
  }, [visible, onClick]);
}
