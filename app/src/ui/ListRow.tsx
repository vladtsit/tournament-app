import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import styles from "./ListRow.module.css";

interface BaseProps {
  leading?: ReactNode;
  primary?: ReactNode;
  secondary?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  bordered?: boolean;
}

export type ListRowProps =
  | (BaseProps &
      Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
        interactive: true;
      })
  | (BaseProps &
      Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
        interactive?: false;
      });

/**
 * Standard list row: optional leading icon/avatar, primary + secondary text,
 * optional trailing slot. When `interactive` is true it renders as a button;
 * otherwise as a div.
 */
export const ListRow = forwardRef<HTMLElement, ListRowProps>(
  function ListRow(props, ref) {
    const {
      leading,
      primary,
      secondary,
      trailing,
      selected,
      bordered = false,
      interactive,
      className,
      ...rest
    } = props as BaseProps & {
      interactive?: boolean;
      className?: string;
    } & Record<string, unknown>;

    const classes = [
      styles["row"],
      bordered ? styles["bordered"] : null,
      interactive ? styles["interactive"] : null,
      selected ? styles["selected"] : null,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    const content = (
      <>
        {leading ? <span className={styles["leading"]}>{leading}</span> : null}
        <span className={styles["body"]}>
          {primary !== undefined && primary !== null ? (
            <span className={styles["primary"]}>{primary}</span>
          ) : null}
          {secondary !== undefined && secondary !== null ? (
            <span className={styles["secondary"]}>{secondary}</span>
          ) : null}
        </span>
        {trailing ? (
          <span className={styles["trailing"]}>{trailing}</span>
        ) : null}
      </>
    );

    if (interactive) {
      return (
        <button
          ref={ref as Ref<HTMLButtonElement>}
          type="button"
          className={classes}
          {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
        >
          {content}
        </button>
      );
    }
    return (
      <div
        ref={ref as Ref<HTMLDivElement>}
        className={classes}
        {...(rest as HTMLAttributes<HTMLDivElement>)}
      >
        {content}
      </div>
    );
  },
);
