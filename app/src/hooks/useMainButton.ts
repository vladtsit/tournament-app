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
 *
 * `visible:false` is a NO-OP — this allows multiple components in the tree to
 * use the hook safely as long as at most one has `visible:true` at any time.
 * The button is hidden automatically when the active host effect cleans up
 * (re-render with new deps, transition to `visible:false`, or unmount).
 */
export function useMainButton({
  visible,
  text,
  enabled = true,
  showProgress = false,
  onClick,
}: Options): void {
  useEffect(() => {
    if (!visible) return;
    const wa = getWebApp();
    const btn = wa?.MainButton;
    if (!btn) return;
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
