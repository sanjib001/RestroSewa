"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { ShieldAlert, X } from "lucide-react";

// Reusable Security-PIN gate. A controlled modal that collects the 4-digit admin PIN and
// hands it to `onConfirm`, which runs the actual server action (verify + do + audit). Any
// sensitive operation reuses this: pass the operation's own fields as `children` (rendered
// above the PIN) and an `onConfirm` that reads both the PIN and those fields.
//
// Self-contained chrome (its own overlay) so it works on both the admin and employee
// surfaces without importing area-specific components.
export function SecurityPinDialog({
  open,
  onClose,
  onSuccess,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  extraValid = true,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  /** Runs the gated action. Return `{ error }` to keep the dialog open with a message. */
  onConfirm: (pin: string) => Promise<{ error: string } | { ok: true } | void | null>;
  /** Whether the consumer's extra fields are currently valid (Confirm stays disabled if not). */
  extraValid?: boolean;
  children?: React.ReactNode;
  wide?: boolean;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Reset whenever it (re)opens, so a stale PIN or error never carries between uses.
  useEffect(() => {
    if (open) { setPin(""); setError(null); setPending(false); }
  }, [open]);

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !pending) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, pending, onClose]);

  if (!open) return null;

  const canConfirm = !pending && extraValid && /^\d{4}$/.test(pin);

  const submit = async () => {
    if (!canConfirm) return;
    setPending(true);
    setError(null);
    try {
      const res = await onConfirm(pin);
      if (res && "error" in res) { setError(res.error); setPending(false); return; }
      onSuccess();
    } catch {
      setError("Something went wrong. Please try again.");
      setPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start sm:items-center justify-center overflow-y-auto p-3 sm:p-6"
      style={{ background: "rgba(13,37,61,0.45)" }}
      onClick={() => { if (!pending) onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} my-auto rounded-2xl overflow-hidden`}
        style={{ background: "var(--color-canvas)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 sm:px-5 py-3.5 border-b" style={{ borderColor: "var(--color-hairline)" }}>
          <div className="min-w-0">
            <p className="text-base font-medium flex items-center gap-2" style={{ color: "var(--color-ink)" }}>
              <ShieldAlert size={16} /> {title}
            </p>
            {description && (
              <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-mute)" }}>{description}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => { if (!pending) onClose(); }}
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 sm:px-5 py-4 max-h-[75vh] overflow-y-auto flex flex-col gap-4">
          {children}

          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
              Security PIN
            </span>
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder="••••"
              value={pin}
              autoFocus
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              className="w-36 tracking-[0.4em]"
            />
          </label>

          {error && (
            <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}>
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => { if (!pending) onClose(); }} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" className="flex-1" onClick={submit} disabled={!canConfirm}>
              {pending ? "Working…" : confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
