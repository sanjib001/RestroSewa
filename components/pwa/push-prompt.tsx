"use client";

import { BellRing, BellOff, ShieldAlert, Smartphone, Loader2, Check, Send } from "lucide-react";
import { usePush } from "@/lib/pwa/use-push";

/**
 * A single strip inside the notification dropdown.
 *
 * This exists because of a mistake worth naming: the switch used to live ONLY on the
 * /employee/notifications page — and staff do not go there. They tap the bell. So the
 * one control that decides whether anyone's phone ever rings sat on a screen nobody
 * opened, and in production not a single device was ever subscribed.
 *
 * So it goes where the attention already is. It is deliberately loud when alerts are
 * OFF (that is the state that costs a guest their waiter) and nearly invisible when
 * they are on — a confirmation line, not a permanent advertisement.
 */
export function PushPrompt() {
  const { state, busy, testing, testResult, enable, test } = usePush();

  if (state === "loading") return null;

  const strip = "shrink-0 flex items-center gap-2.5 px-4 py-2.5 border-b text-xs";

  // ── Alerts are ON: a quiet confirmation, plus the one thing people actually want
  //    to know, which is "did it really work?" ────────────────────────────────────
  if (state === "on") {
    return (
      <div
        className={strip}
        style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
      >
        <Check size={13} className="shrink-0" style={{ color: "#1a7a4a" }} />
        <p className="min-w-0 flex-1 break-words" style={{ color: "var(--color-ink-mute)" }}>
          {testResult ?? "Alerts on — this phone will ring even when the app is closed."}
        </p>
        <button
          type="button"
          onClick={test}
          disabled={testing}
          className="shrink-0 inline-flex items-center gap-1 min-h-[32px] px-2.5 rounded-lg font-medium border disabled:opacity-60"
          style={{
            background: "var(--color-canvas-soft)",
            color: "var(--color-primary)",
            borderColor: "var(--color-hairline)",
          }}
        >
          {testing ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
          {testing ? "…" : "Test"}
        </button>
      </div>
    );
  }

  // ── Alerts are OFF but CAN be turned on. The important case. ──────────────────
  if (state === "off") {
    return (
      <div
        className={strip}
        style={{ borderColor: "var(--color-hairline)", background: "var(--color-primary)" + "0d" }}
      >
        <BellRing size={14} className="shrink-0" style={{ color: "var(--color-primary)" }} />
        <p className="min-w-0 flex-1 break-words" style={{ color: "var(--color-ink)" }}>
          Alerts are off — you&apos;ll miss calls when the app is closed.
        </p>
        <button
          type="button"
          onClick={enable}
          disabled={busy}
          className="shrink-0 inline-flex items-center gap-1 min-h-[32px] px-3 rounded-lg font-medium disabled:opacity-60"
          style={{ background: "var(--color-primary)", color: "#fff" }}
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : null}
          {busy ? "…" : "Turn on"}
        </button>
      </div>
    );
  }

  // ── Everything below is a reason it CAN'T be turned on. Each one names itself.
  //    Rendering nothing here is what hid the failure for a whole release. ───────
  const reason: Record<string, { icon: typeof BellOff; tint: string; text: string }> = {
    insecure: {
      icon: ShieldAlert,
      tint: "var(--color-ruby)",
      text: "Alerts need an https connection — this page is on plain http.",
    },
    "no-sw": {
      icon: ShieldAlert,
      tint: "var(--color-lemon)",
      text: "Alerts are off in a development build. Use npm run build && npm start.",
    },
    "ios-needs-install": {
      icon: Smartphone,
      tint: "var(--color-lemon)",
      text: "On iPhone: Share → Add to Home Screen, then alerts can be turned on.",
    },
    denied: {
      icon: BellOff,
      tint: "var(--color-ruby)",
      text: "Notifications are blocked. Re-enable them in your browser settings.",
    },
    unsupported: {
      icon: BellOff,
      tint: "var(--color-ink-mute)",
      text: "This browser can't do notifications.",
    },
  };

  const r = reason[state];
  if (!r) return null;
  const Icon = r.icon;

  return (
    <div
      className={strip}
      style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
    >
      <Icon size={14} className="shrink-0" style={{ color: r.tint }} />
      <p className="min-w-0 flex-1 break-words" style={{ color: "var(--color-ink-mute)" }}>
        {r.text}
      </p>
    </div>
  );
}
