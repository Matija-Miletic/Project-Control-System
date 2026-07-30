"use client";

import { ReactNode, useEffect } from "react";

export function ItemModal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="item-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-modal-title"
      >
        <header>
          <h2 id="item-modal-title">{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function CollapsibleRegister({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <details className="collapsible-register">
      <summary>
        <span>
          <strong>{title}</strong>
          <small>{count} {count === 1 ? "item" : "items"}</small>
        </span>
        <span className="summary-action">Show table</span>
      </summary>
      <div className="collapsible-content">{children}</div>
    </details>
  );
}
