import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}

/**
 * Friendly placeholder for empty lists / unfetched data. Pass a lucide icon
 * (rendered at 40px) and short copy. Optional CTA button below.
 */
export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: "var(--space-2)",
        padding: "var(--space-5) var(--space-4)",
        color: "var(--text-muted)",
      }}
    >
      {icon ? (
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 56,
            height: 56,
            borderRadius: "var(--radius-pill)",
            background: "var(--accent-soft)",
            color: "var(--accent)",
            marginBottom: "var(--space-1)",
          }}
        >
          {icon}
        </span>
      ) : null}
      <div
        style={{
          fontSize: "var(--font-md)",
          fontWeight: "var(--weight-semibold)",
          color: "var(--text)",
        }}
      >
        {title}
      </div>
      {body ? (
        <div style={{ fontSize: "var(--font-sm)", maxWidth: 320 }}>{body}</div>
      ) : null}
      {action ? (
        <div style={{ marginTop: "var(--space-2)" }}>{action}</div>
      ) : null}
    </div>
  );
}
