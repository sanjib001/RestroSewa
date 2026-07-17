"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

// Shared dialog chrome for the Stock & Finance module (Vendors, Stock,
// Purchases). Consistent with the admin dashboard: a centred card on desktop,
// full-width and scrollable on mobile.

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  // Escape closes; body scroll is locked so the page behind doesn't move.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start sm:items-center justify-center overflow-y-auto p-3 sm:p-6"
      style={{ background: "rgba(13,37,61,0.45)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} my-auto rounded-2xl overflow-hidden`}
        style={{ background: "var(--color-canvas)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-start justify-between gap-3 px-4 sm:px-5 py-3.5 border-b"
          style={{ borderColor: "var(--color-hairline)" }}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>
              {title}
            </p>
            {subtitle && (
              <p className="text-xs mt-0.5 truncate" style={{ color: "var(--color-ink-mute)" }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 sm:px-5 py-4 max-h-[75vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// Confirmation before anything destructive or hard to undo.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  destructive = false,
  pending = false,
  error = null,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <p className="text-sm mb-4" style={{ color: "var(--color-ink-mute)" }}>
        {message}
      </p>

      {error && (
        <p
          className="text-sm rounded-md px-3 py-2 mb-3"
          style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}
        >
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        {destructive ? (
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="flex-1 rounded-pill py-2 text-base font-normal transition-colors disabled:opacity-50"
            style={{ background: "#dc2626", color: "#fff" }}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        ) : (
          <Button variant="primary" className="flex-1" onClick={onConfirm} disabled={pending}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        )}
      </div>
    </Modal>
  );
}
