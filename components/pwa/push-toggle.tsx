"use client";

import { Bell, BellOff, BellRing, Loader2, Smartphone, ShieldAlert, Send } from "lucide-react";
import { usePush } from "@/lib/pwa/use-push";

/**
 * The full-size switch on the Notifications page.
 *
 * The compact version that actually gets used lives in the notification dropdown
 * (components/pwa/push-prompt.tsx) — that is where staff are. This one is the settings
 * view: same hook, same truth, more room to explain itself.
 *
 * It never renders `null` for a failure. The first version did, and a component that
 * vanishes exactly when something is wrong is how push shipped broken for a whole
 * release with nobody able to see why.
 */
export function PushToggle() {
  const { state, busy, testing, testResult, enable, disable, test } = usePush();

  const shell = "rounded-xl border px-4 py-3 mb-4 flex items-center gap-3";
  const shellStyle = {
    background: "var(--color-canvas)",
    borderColor: "var(--color-hairline)",
  };

  const notice = (tint: string, Icon: typeof Bell, title: string, detail: string) => (
    <div className={shell} style={shellStyle}>
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: tint + "18" }}
      >
        <Icon size={16} style={{ color: tint }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
          {title}
        </p>
        <p
          className="text-xs mt-0.5 leading-relaxed break-words"
          style={{ color: "var(--color-ink-mute)" }}
        >
          {detail}
        </p>
      </div>
    </div>
  );

  if (state === "loading") {
    return (
      <div className={shell} style={{ ...shellStyle, opacity: 0.6 }}>
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "var(--color-ink-mute)15" }}
        >
          <Loader2 size={16} className="animate-spin" style={{ color: "var(--color-ink-mute)" }} />
        </div>
        <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
          Checking alerts…
        </p>
      </div>
    );
  }

  // Served over plain http, so the browser refuses to expose a service worker at all —
  // and every symptom of that looks like "the feature is missing" rather than "the
  // connection is wrong". This is the one that bites people testing on a phone.
  if (state === "insecure") {
    return notice(
      "var(--color-ruby)",
      ShieldAlert,
      "Alerts need a secure (https) connection",
      "This page is served over plain http, so the browser blocks notifications " +
        "entirely. A phone on your local network cannot use localhost, so it needs a " +
        "real https address or a tunnel."
    );
  }

  if (state === "no-sw") {
    return notice(
      "var(--color-lemon)",
      ShieldAlert,
      "Alerts are off in development",
      "The service worker isn't registered in a dev build, so nothing can receive a " +
        "push. Run a production build (npm run build, then npm start) to turn alerts on."
    );
  }

  if (state === "unsupported") {
    return notice(
      "var(--color-ink-mute)",
      BellOff,
      "This browser can't do notifications",
      "Alerts need a browser that supports web push — try Chrome or Edge on Android, " +
        "or install the app on iPhone."
    );
  }

  if (state === "ios-needs-install") {
    return notice(
      "var(--color-lemon)",
      Smartphone,
      "Add to Home Screen to get alerts",
      "On iPhone and iPad, Safari only delivers notifications to an installed app. " +
        "Tap Share → Add to Home Screen, then open RestroSewa from your home screen."
    );
  }

  if (state === "denied") {
    // Permission cannot be re-requested once denied — the browser will not even show
    // the prompt again. Only the user can undo it, from settings, so offering a
    // "try again" button would be a lie.
    return notice(
      "var(--color-ruby)",
      BellOff,
      "Notifications are blocked",
      "You blocked notifications for this site. Re-enable them in your browser or " +
        "phone settings — the app can no longer ask."
    );
  }

  const on = state === "on";

  return (
    <div className="rounded-xl border mb-4 overflow-hidden" style={shellStyle}>
      <div className="px-4 py-3 flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: (on ? "var(--color-primary)" : "var(--color-ink-mute)") + "15" }}
        >
          {on ? (
            <BellRing size={16} style={{ color: "var(--color-primary)" }} />
          ) : (
            <Bell size={16} style={{ color: "var(--color-ink-mute)" }} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            {on ? "Alerts on for this device" : "Turn on alerts for this device"}
          </p>
          <p className="text-xs mt-0.5 break-words" style={{ color: "var(--color-ink-mute)" }}>
            {on
              ? "Waiter calls and bill requests will reach you even when the app is closed."
              : "Get woken for waiter calls and bill requests, even with the app closed."}
          </p>
        </div>

        <button
          type="button"
          onClick={on ? disable : enable}
          disabled={busy}
          className="shrink-0 inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg text-xs font-medium border disabled:opacity-60"
          style={
            on
              ? {
                  background: "var(--color-canvas)",
                  color: "var(--color-ink-mute)",
                  borderColor: "var(--color-hairline)",
                }
              : { background: "var(--color-primary)", color: "#fff", borderColor: "transparent" }
          }
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : null}
          {busy ? "…" : on ? "Turn off" : "Turn on"}
        </button>
      </div>

      {/* Once it's on, the only question left is "did it actually work?" — and before
          this the only way to find out was to persuade a guest to tap "call waiter" and
          hope. A quiet phone looks the same whether the setup is broken or the feature
          was never built. */}
      {on && (
        <div
          className="px-4 py-2.5 border-t flex items-center justify-between gap-3"
          style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
        >
          <p
            className="text-xs min-w-0 break-words"
            style={{ color: testResult ? "var(--color-ink)" : "var(--color-ink-mute)" }}
          >
            {testResult ?? "Not sure it's working? Send yourself one."}
          </p>
          <button
            type="button"
            disabled={testing}
            onClick={test}
            className="shrink-0 inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg text-xs font-medium border disabled:opacity-60"
            style={{
              background: "var(--color-canvas)",
              color: "var(--color-primary)",
              borderColor: "var(--color-hairline)",
            }}
          >
            {testing ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {testing ? "Sending…" : "Test"}
          </button>
        </div>
      )}
    </div>
  );
}
