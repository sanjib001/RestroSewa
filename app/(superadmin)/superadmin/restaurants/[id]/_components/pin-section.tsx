"use client";

import { useTransition } from "react";
import { regenerateSessionPin, clearSessionPin } from "@/app/actions/pos";
import type { ActiveSessionPin } from "@/app/actions/pos";
import { RefreshCw, X } from "lucide-react";

function timeSince(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export function PinSection({ sessions }: { sessions: ActiveSessionPin[] }) {
  const [, start] = useTransition();

  if (sessions.length === 0) return null;

  return (
    <div className="mb-6">
      <h2
        className="text-base mb-3"
        style={{ color: "var(--color-ink)", fontWeight: 400 }}
      >
        Active session PINs
        <span className="ml-2 text-sm" style={{ color: "var(--color-ink-mute)" }}>
          ({sessions.length})
        </span>
      </h2>

      <div className="flex flex-col gap-2">
        {sessions.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-4 px-4 py-3 rounded-lg border flex-wrap"
            style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                {s.table_number ? `Table ${s.table_number}` : s.type === "walk_in" ? "Walk-in" : "—"}
              </p>
              <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                Opened {timeSince(s.opened_at)}
              </p>
            </div>

            {/* PIN display */}
            <div className="flex items-center gap-1">
              {s.customer_pin ? (
                s.customer_pin.split("").map((digit, i) => (
                  <div
                    key={i}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-medium"
                    style={{ background: "var(--color-canvas-soft)", color: "var(--color-primary)", fontWeight: 600 }}
                  >
                    {digit}
                  </div>
                ))
              ) : (
                <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>No PIN</span>
              )}
            </div>

            {/* Actions */}
            <button
              type="button"
              title="Regenerate PIN"
              onClick={() => start(async () => { await regenerateSessionPin(s.id); })}
              style={{ color: "var(--color-ink-mute)" }}
            >
              <RefreshCw size={13} />
            </button>
            <button
              type="button"
              title="Clear PIN (revoke customer ordering)"
              onClick={() =>
                start(async () => {
                  if (confirm("Clear PIN? Customers will lose ordering access until a new PIN is set.")) {
                    await clearSessionPin(s.id);
                  }
                })
              }
              style={{ color: "var(--color-ink-mute)" }}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
