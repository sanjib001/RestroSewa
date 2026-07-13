"use client";

import {
  useState,
  useTransition,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { RestaurantLogo } from "@/components/branding/restaurant-logo";
import { FoodMark } from "@/components/ui/food-mark";
import type { FoodType } from "@/lib/food-types";
import type { CategoryRow, MenuItemRow, VariantRow } from "@/app/actions/menu";
import {
  sendNotification,
  verifyCustomerPin,
  checkSessionActive,
  submitCustomerOrder,
  requestTableActivation,
  getCustomerActivationState,
  getCustomerOrderFeed,
  getCustomerNotifState,
  acknowledgeCustomerReady,
} from "@/app/actions/customer";
import type {
  CustomerCartItem,
  CustomerNotifState,
  NotificationStatus,
  CustomerOrder,
  CustomerOrderStatus,
  ActivationStatus,
} from "@/app/actions/customer";
import { createPortal } from "react-dom";
import {
  Bell,
  BellRing,
  Search,
  Plus,
  Minus,
  ShoppingBag,
  X,
  Lock,
  Receipt,
  CheckCircle2,
  ChefHat,
  Clock,
  Sparkles,
  Info,
  Home,
  ClipboardList,
  ConciergeBell,
  Timer,
  ShieldCheck,
  Utensils,
  UtensilsCrossed,
  LayoutGrid,
  Coffee,
  CupSoda,
  IceCreamCone,
  Pizza,
  Sandwich,
  Salad,
  Soup,
  Croissant,
  Fish,
  Drumstick,
  Beef,
  Wine,
  Cookie,
  Leaf,
  Flame,
  Loader2,
  ChevronRight,
  MapPin,
  Hourglass,
  XCircle,
} from "lucide-react";

// ─── Config ─────────────────────────────────────────────────────────────────────

// The customer now gets pushed updates over SSE; this is only a safety net for a
// dropped stream (flaky café wifi, phone waking from sleep).
const POLL_MS = 60000;

type FoodKey = FoodType;

// Per-order status presentation for the live tracker.
const ORDER_STATUS_META: Record<
  CustomerOrderStatus,
  { label: string; color: string; bg: string; Icon: React.ComponentType<{ size?: number }> }
> = {
  pending: { label: "Preparing", color: "#b45309", bg: "#fff7ed", Icon: ChefHat },
  ready:   { label: "Ready",     color: "#0d9488", bg: "#ecfdf5", Icon: CheckCircle2 },
  served:  { label: "Served",    color: "#64748b", bg: "#f1f5f9", Icon: Receipt },
};

// Category → glyph. Matched loosely on the category name so any menu gets sensible art.
const CATEGORY_ICONS: { test: RegExp; Icon: React.ComponentType<{ size?: number }> }[] = [
  { test: /coffee|tea|chai|hot drink/i, Icon: Coffee },
  { test: /juice|soda|cola|drink|beverage|shake|smoothie|mocktail|lassi/i, Icon: CupSoda },
  { test: /beer|wine|cocktail|bar|liquor|alcohol/i, Icon: Wine },
  { test: /ice ?cream|dessert|sweet|cake|pastry|kulfi/i, Icon: IceCreamCone },
  { test: /cookie|bakery|bake/i, Icon: Cookie },
  { test: /pizza/i, Icon: Pizza },
  { test: /burger|sandwich|wrap|roll/i, Icon: Sandwich },
  { test: /salad/i, Icon: Salad },
  { test: /soup|broth/i, Icon: Soup },
  { test: /bread|naan|roti|paratha|croissant/i, Icon: Croissant },
  { test: /fish|seafood|prawn/i, Icon: Fish },
  { test: /chicken|tandoor|kebab|grill|wings/i, Icon: Drumstick },
  { test: /mutton|beef|lamb|steak|meat/i, Icon: Beef },
  { test: /veg|paneer|curry|dal|sabzi/i, Icon: Leaf },
  { test: /starter|appetizer|snack|bites/i, Icon: Utensils },
];

function iconForCategory(name: string): React.ComponentType<{ size?: number }> {
  return CATEGORY_ICONS.find((c) => c.test.test(name))?.Icon ?? UtensilsCrossed;
}

const rupee = (n: number) => `₹${n.toFixed(0)}`;

function isSpicy(item: MenuItemRow): boolean {
  return item.badges?.some((b) => /spic|hot|chilli|chili/i.test(b)) ?? false;
}

// ─── Injected animation primitives (Tailwind animate utilities aren't configured) ─

function AnimationStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
@keyframes rs-slide-down { from { opacity:0; transform:translate(-50%,-16px) } to { opacity:1; transform:translate(-50%,0) } }
@keyframes rs-drop       { from { opacity:0; transform:translateY(-14px) }     to { opacity:1; transform:translateY(0) } }
@keyframes rs-slide-up   { from { opacity:0; transform:translateY(28px) }      to { opacity:1; transform:translateY(0) } }
@keyframes rs-sheet-in   { from { transform:translateY(100%) }                 to { transform:translateY(0) } }
@keyframes rs-fade       { from { opacity:0 } to { opacity:1 } }
@keyframes rs-fade-up    { from { opacity:0; transform:translateY(8px) }       to { opacity:1; transform:translateY(0) } }
@keyframes rs-pop        { 0% { transform:scale(.9); opacity:0 } 60% { transform:scale(1.03) } 100% { transform:scale(1); opacity:1 } }
@keyframes rs-ring       { 0%,100% { transform:rotate(0) } 20% { transform:rotate(-14deg) } 40% { transform:rotate(11deg) } 60% { transform:rotate(-7deg) } 80% { transform:rotate(4deg) } }
@keyframes rs-check      { 0% { transform:scale(0); opacity:0 } 55% { transform:scale(1.15) } 100% { transform:scale(1); opacity:1 } }
@keyframes rs-float      { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-4px) } }
@keyframes rs-pulse-ring { 0% { box-shadow:0 0 0 0 rgba(8,145,178,.45) } 70% { box-shadow:0 0 0 12px rgba(8,145,178,0) } 100% { box-shadow:0 0 0 0 rgba(8,145,178,0) } }
.rs-slide-down { animation: rs-slide-down .34s cubic-bezier(.2,.8,.2,1) both }
.rs-drop       { animation: rs-drop .34s cubic-bezier(.2,.8,.2,1) both }
.rs-slide-up   { animation: rs-slide-up .3s cubic-bezier(.2,.8,.2,1) both }
.rs-sheet-in   { animation: rs-sheet-in .32s cubic-bezier(.2,.85,.25,1) both }
.rs-fade       { animation: rs-fade .22s ease both }
.rs-fade-up    { animation: rs-fade-up .32s cubic-bezier(.2,.8,.2,1) both }
.rs-pop        { animation: rs-pop .3s cubic-bezier(.2,.8,.2,1) both }
.rs-ring       { animation: rs-ring 1.1s ease-in-out infinite }
.rs-check      { animation: rs-check .5s cubic-bezier(.2,.8,.2,1) both }
.rs-float      { animation: rs-float 3s ease-in-out infinite }
.rs-pulse-ring { animation: rs-pulse-ring 2s ease-out infinite }
.rs-press      { transition: transform .12s ease, box-shadow .2s ease, background .2s ease }
.rs-press:active { transform: scale(.95) }
.rs-noscroll::-webkit-scrollbar { display:none }
.rs-elev { box-shadow: 0 1px 2px rgba(13,37,61,.04), 0 8px 24px rgba(13,37,61,.05) }
.rs-elev-lg { box-shadow: 0 8px 40px rgba(13,37,61,.14) }
.rs-card { box-shadow: 0 1px 2px rgba(13,37,61,.04); transition: box-shadow .22s ease, transform .22s ease, border-color .22s ease }
@media (hover:hover) { .rs-card:hover { box-shadow: 0 10px 30px rgba(13,37,61,.09); transform: translateY(-2px); border-color: #d7dee8 } }
`,
      }}
    />
  );
}

// ─── Small shared pieces ─────────────────────────────────────────────────────────

// "All" is a VIRTUAL category — it is never stored, never fetched, and never
// owns an item. This sentinel stands in for it in the same `activeCategoryId`
// state the real categories use, so selecting it costs no extra state and no
// extra request. A `__`-fenced literal cannot collide with a uuid.
const ALL_CATEGORY_ID = "__all__";

// ─── Cart line keys ──────────────────────────────────────────────────────────
// A cart line is a dish AND the variant chosen for it. Two Large Coffees and one
// Small Coffee are two lines, not three of one thing — they cost different
// amounts and print differently on the kitchen ticket, so they can't share a key.

type LineKey = string;

const keyOf = (itemId: string, variantId: string | null): LineKey =>
  variantId ? `${itemId}::${variantId}` : itemId;

const parseKey = (key: LineKey): { itemId: string; variantId: string | null } => {
  const [itemId, variantId] = key.split("::");
  return { itemId, variantId: variantId ?? null };
};

// The monogram that used to live here is now the FALLBACK inside
// <RestaurantLogo>, so an uploaded logo and the initials share one component
// and one set of sizes.

function DietMark({ type, size = 15 }: { type: FoodKey; size?: number }) {
  return <FoodMark type={type} size={size} />;
}

function Pill({
  children,
  color,
  bg,
  Icon,
}: {
  children: React.ReactNode;
  color: string;
  bg: string;
  Icon?: React.ComponentType<{ size?: number }>;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg leading-none"
      style={{ color, background: bg }}
    >
      {Icon && <Icon size={11} />}
      {children}
    </span>
  );
}

function HeroChip({ Icon, children }: { Icon: React.ComponentType<{ size?: number }>; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full"
      style={{ background: "rgba(255,255,255,0.14)", color: "#fff" }}
    >
      <Icon size={13} />
      {children}
    </span>
  );
}

// Generic bottom-sheet / centered-dialog. Mobile: sheet from bottom. Desktop: centered card.
function Sheet({
  open,
  onClose,
  children,
  maxWidth = 480,
  label,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
  label?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
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
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center rs-fade"
      style={{ background: "rgba(13,37,61,0.42)", backdropFilter: "blur(2px)" }}
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden rs-sheet-in sm:rs-pop rs-elev-lg"
        style={{ background: "var(--color-canvas)", maxWidth, maxHeight: "88vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <span className="rounded-full" style={{ width: 40, height: 4, background: "var(--color-hairline)" }} />
        </div>
        {children}
      </div>
    </div>
  );
}

function SheetHeader({
  title,
  subtitle,
  onClose,
  icon,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: "var(--color-hairline)" }}>
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-base font-medium" style={{ color: "var(--color-ink)" }}>{title}</p>
        {subtitle && <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>{subtitle}</p>}
      </div>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="w-9 h-9 rounded-full flex items-center justify-center rs-press shrink-0"
        style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
      >
        <X size={17} />
      </button>
    </div>
  );
}

// ─── PIN entry ─────────────────────────────────────────────────────────────────

function PinEntry({
  sessionId,
  tableId,
  roomId,
  cacheKey,
  isRoom,
  onSuccess,
  onClose,
}: {
  sessionId: string | null;
  tableId: string | null;
  roomId: string | null;
  cacheKey: string;
  isRoom: boolean;
  onSuccess: (resolvedSessionId: string) => void;
  onClose: () => void;
}) {
  const [digits, setDigits] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const addDigit = useCallback(
    async (d: string) => {
      if (verifying) return;
      setError(null);
      const next = [...digits, d];
      setDigits(next);
      if (next.length === 4) {
        setVerifying(true);
        const result = await verifyCustomerPin(sessionId, next.join(""), tableId, roomId);
        if (result.success && result.resolvedSessionId) {
          try {
            localStorage.setItem(`rs_auth_${cacheKey}`, JSON.stringify({ sessionId: result.resolvedSessionId }));
          } catch {
            /* storage unavailable — ordering still works this session */
          }
          onSuccess(result.resolvedSessionId);
        } else {
          setDigits([]);
          setError("Incorrect PIN. Please try again.");
          setVerifying(false);
        }
      }
    },
    [digits, verifying, sessionId, tableId, roomId, cacheKey, onSuccess]
  );

  const backspace = useCallback(() => {
    setError(null);
    setDigits((prev) => prev.slice(0, -1));
  }, []);

  const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <Sheet open onClose={onClose} maxWidth={400} label="Enter ordering PIN">
      <div className="px-6 pt-2 pb-7 flex flex-col gap-5">
        <div className="flex flex-col items-center text-center gap-2 pt-2">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center rs-float"
            style={{ background: "rgba(8,145,178,0.1)", color: "var(--color-primary)" }}
          >
            <Lock size={24} />
          </div>
          <p className="text-lg" style={{ color: "var(--color-ink)", fontWeight: 500 }}>Unlock ordering</p>
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            Ask {isRoom ? "the front desk" : "your waiter"} for the 4-digit PIN
          </p>
        </div>

        <div className="flex justify-center gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="w-12 h-14 rounded-2xl flex items-center justify-center text-2xl transition-all"
              style={{
                background: "var(--color-canvas-soft)",
                border: `2px solid ${digits[i] !== undefined ? "var(--color-primary)" : "var(--color-hairline)"}`,
                color: "var(--color-primary)",
                fontWeight: 600,
                transform: digits[i] !== undefined ? "scale(1.04)" : "scale(1)",
              }}
            >
              {digits[i] !== undefined ? "•" : ""}
            </div>
          ))}
        </div>

        {error && <p className="text-center text-sm" style={{ color: "var(--color-ruby)" }}>{error}</p>}
        {verifying && (
          <p className="text-center text-sm flex items-center justify-center gap-1.5" style={{ color: "var(--color-ink-mute)" }}>
            <Loader2 size={14} className="animate-spin" /> Verifying…
          </p>
        )}

        <div className="grid grid-cols-3 gap-2.5">
          {KEYS.map((k, i) =>
            k === "" ? (
              <div key={i} />
            ) : k === "⌫" ? (
              <button
                key="back"
                type="button"
                aria-label="Backspace"
                onClick={backspace}
                disabled={verifying}
                className="h-14 rounded-2xl text-xl flex items-center justify-center rs-press"
                style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink)" }}
              >
                ⌫
              </button>
            ) : (
              <button
                key={k}
                type="button"
                onClick={() => addDigit(k)}
                disabled={digits.length >= 4 || verifying}
                className="h-14 rounded-2xl text-xl font-medium rs-press"
                style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink)" }}
              >
                {k}
              </button>
            )
          )}
        </div>
      </div>
    </Sheet>
  );
}

// ─── Toasts ──────────────────────────────────────────────────────────────────────

type Toast = { id: string; tone: "success" | "info" | "primary"; title: string; body?: string; Icon: React.ComponentType<{ size?: number }>; desktopOnly?: boolean };

function ToastStack({ toasts, onOpen, onClose }: { toasts: Toast[]; onOpen: (t: Toast) => void; onClose: (id: string) => void }) {
  // Portal to <body> so no ancestor (root overflow-x-hidden, animated/transformed
  // wrappers, sheets) can clip the toast or shift its containing block. Guarded so
  // it only renders client-side where `document` exists.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Literal colors — portaled out of the page's scoped CSS-var overrides, so we
  // can't rely on var(--color-primary) here (it would resolve to the global brand).
  const TONES: Record<Toast["tone"], string> = {
    success: "linear-gradient(135deg,#0d9488,#15b981)",
    primary: "linear-gradient(135deg,#0891b2,#0e7490)",
    info: "linear-gradient(135deg,#334155,#0f172a)",
  };

  if (!mounted || toasts.length === 0) return null;

  const stack = (
    <div
      className="fixed left-1/2 w-[min(440px,calc(100vw-24px))] flex flex-col gap-2 pointer-events-none"
      style={{
        top: "calc(env(safe-area-inset-top, 0px) + 12px)",
        transform: "translateX(-50%)",
        zIndex: 2147483000,
      }}
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onOpen(t)}
          className={`w-full ${t.desktopOnly ? "hidden lg:flex" : "flex"} items-center gap-3 px-4 py-3.5 rounded-2xl text-left rs-drop rs-elev-lg pointer-events-auto`}
          style={{ background: TONES[t.tone], color: "#fff" }}
        >
          <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.2)" }}>
            <t.Icon size={20} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold truncate">{t.title}</span>
            {t.body && <span className="block text-xs truncate" style={{ color: "rgba(255,255,255,0.85)" }}>{t.body}</span>}
          </span>
          <span
            role="button"
            tabIndex={0}
            aria-label="Dismiss"
            onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
            className="shrink-0 opacity-80"
          >
            <X size={16} />
          </span>
        </button>
      ))}
    </div>
  );

  return createPortal(stack, document.body);
}

// ─── Order timeline + orders sheet ───────────────────────────────────────────────

const TIMELINE = [
  { key: "placed",  label: "Order received", Icon: ClipboardList },
  { key: "pending", label: "Preparing",      Icon: ChefHat },
  { key: "ready",   label: "Ready",          Icon: CheckCircle2 },
  { key: "served",  label: "Served",         Icon: Receipt },
] as const;

function OrderTimeline({ status }: { status: CustomerOrderStatus }) {
  const activeIndex = status === "served" ? 3 : status === "ready" ? 2 : 1; // "placed" always done
  const accent = status === "ready" || status === "served" ? "#0d9488" : "#b45309";
  return (
    <div className="flex flex-col gap-0 mt-3">
      {TIMELINE.map((step, i) => {
        const done = i <= activeIndex;
        const current = i === activeIndex;
        const last = i === TIMELINE.length - 1;
        return (
          <div key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all"
                style={{
                  background: done ? accent : "var(--color-canvas-soft)",
                  color: done ? "#fff" : "var(--color-ink-mute)",
                  border: done ? "none" : "1.5px solid var(--color-hairline)",
                }}
              >
                <step.Icon size={14} />
              </div>
              {!last && <span className="w-0.5 flex-1 my-0.5" style={{ minHeight: 18, background: i < activeIndex ? accent : "var(--color-hairline)" }} />}
            </div>
            <div className={last ? "" : "pb-3"}>
              <p className="text-sm" style={{ color: done ? "var(--color-ink)" : "var(--color-ink-mute)", fontWeight: current ? 600 : 400 }}>{step.label}</p>
              {current && <p className="text-xs" style={{ color: accent }}>In progress</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OrdersSheet({
  open,
  orders,
  onClose,
  onRequestBill,
  billState,
}: {
  open: boolean;
  orders: CustomerOrder[];
  onClose: () => void;
  onRequestBill: () => void;
  billState: NotificationStatus;
}) {
  const grandTotal = orders.reduce((s, o) => s + o.total, 0);
  return (
    <Sheet open={open} onClose={onClose} maxWidth={520} label="Your orders">
      <SheetHeader
        title="Your orders"
        subtitle={orders.length ? `${orders.length} order${orders.length !== 1 ? "s" : ""} · live status` : "Track your kitchen updates here"}
        onClose={onClose}
        icon={<span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(8,145,178,0.1)", color: "var(--color-primary)" }}><Receipt size={18} /></span>}
      />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3 rs-noscroll">
        {orders.length === 0 ? (
          <EmptyState Icon={ClipboardList} title="No orders yet" body="Add a few dishes and place your first order — you'll track every step here." />
        ) : (
          orders.map((o) => {
            const meta = ORDER_STATUS_META[o.status];
            const time = new Date(o.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
            return (
              <div key={o.id} className="rounded-2xl border overflow-hidden rs-pop" style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}>
                <div className="flex items-center gap-3 px-4 py-3" style={{ background: meta.bg }}>
                  <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#fff", color: meta.color }}>
                    <meta.Icon size={17} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: meta.color }}>{meta.label}</p>
                    <p className="text-xs flex items-center gap-1" style={{ color: "var(--color-ink-mute)" }}><Clock size={10} /> {time}</p>
                  </div>
                  <span className="text-sm font-medium tabular" style={{ color: "var(--color-ink)" }}>{rupee(o.total)}</span>
                </div>
                <div className="px-4 pt-3 pb-3">
                  {o.items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between py-1">
                      <span className="text-sm" style={{ color: "var(--color-ink)", opacity: it.status === "served" ? 0.5 : 1 }}>
                        {it.quantity > 1 && <span className="text-xs mr-1" style={{ color: "var(--color-ink-mute)" }}>×{it.quantity}</span>}
                        {it.name}
                      </span>
                      <span className="text-xs font-medium" style={{ color: ORDER_STATUS_META[it.status].color }}>{ORDER_STATUS_META[it.status].label}</span>
                    </div>
                  ))}
                  <OrderTimeline status={o.status} />
                </div>
              </div>
            );
          })
        )}
      </div>
      {orders.length > 0 && (
        <div className="px-4 py-4 border-t flex items-center gap-3" style={{ borderColor: "var(--color-hairline)" }}>
          <div className="flex-1">
            <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Total so far</p>
            <p className="text-lg font-semibold tabular" style={{ color: "var(--color-ink)" }}>{rupee(grandTotal)}</p>
          </div>
          <button
            type="button"
            onClick={onRequestBill}
            disabled={!!billState}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-medium rs-press"
            style={{ background: billState ? "var(--color-canvas-soft)" : "var(--color-ink)", color: billState ? "var(--color-ink-mute)" : "#fff" }}
          >
            <Receipt size={16} />
            {billState === "acknowledged" ? "Bill on the way" : billState === "new" ? "Bill requested" : "Request bill"}
          </button>
        </div>
      )}
    </Sheet>
  );
}

// ─── Notification center ─────────────────────────────────────────────────────────

type NotifEntry = {
  id: string;
  title: string;
  body: string;
  time: string;
  tone: "primary" | "success" | "warning" | "neutral";
  Icon: React.ComponentType<{ size?: number }>;
};

function NotificationCenter({ open, entries, onClose }: { open: boolean; entries: NotifEntry[]; onClose: () => void }) {
  const TONE: Record<NotifEntry["tone"], string> = {
    primary: "var(--color-primary)",
    success: "#0d9488",
    warning: "#b45309",
    neutral: "var(--color-ink-mute)",
  };
  return (
    <Sheet open={open} onClose={onClose} maxWidth={460} label="Notifications">
      <SheetHeader
        title="Notifications"
        subtitle="Order & service updates"
        onClose={onClose}
        icon={<span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(8,145,178,0.1)", color: "var(--color-primary)" }}><BellRing size={18} /></span>}
      />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-2 rs-noscroll">
        {entries.length === 0 ? (
          <EmptyState Icon={Bell} title="You're all caught up" body="Order updates and staff responses will show up here in real time." />
        ) : (
          entries.map((e) => (
            <div key={e.id} className="flex items-start gap-3 px-3 py-3 rounded-2xl rs-fade" style={{ background: "var(--color-canvas-soft)" }}>
              <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: TONE[e.tone] + "1a", color: TONE[e.tone] }}>
                <e.Icon size={17} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{e.title}</p>
                <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>{e.body}</p>
              </div>
              <span className="text-xs shrink-0" style={{ color: "var(--color-ink-mute)" }}>{e.time}</span>
            </div>
          ))
        )}
      </div>
    </Sheet>
  );
}

// ─── Confirm / action dialog (call waiter, request bill) ─────────────────────────

function ActionDialog({
  open,
  title,
  message,
  confirmLabel,
  tone,
  Icon,
  state,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  tone: string;
  Icon: React.ComponentType<{ size?: number }>;
  state: "idle" | "loading" | "success";
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={state === "loading" ? () => {} : onClose} maxWidth={380} label={title}>
      <div className="px-6 pt-3 pb-7 flex flex-col items-center text-center gap-4">
        {state === "success" ? (
          <>
            <div className="w-16 h-16 rounded-full flex items-center justify-center rs-check" style={{ background: "#0d948815", color: "#0d9488" }}>
              <CheckCircle2 size={34} />
            </div>
            <div>
              <p className="text-lg" style={{ color: "var(--color-ink)", fontWeight: 500 }}>Done</p>
              <p className="text-sm mt-1" style={{ color: "var(--color-ink-mute)" }}>{message}</p>
            </div>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center rs-float" style={{ background: tone + "18", color: tone }}>
              <Icon size={30} />
            </div>
            <div>
              <p className="text-lg" style={{ color: "var(--color-ink)", fontWeight: 500 }}>{title}</p>
              <p className="text-sm mt-1" style={{ color: "var(--color-ink-mute)" }}>{message}</p>
            </div>
            <div className="flex gap-2.5 w-full mt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={state === "loading"}
                className="flex-1 h-12 rounded-2xl text-sm font-medium rs-press"
                style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={state === "loading"}
                className="flex-1 h-12 rounded-2xl text-sm font-medium rs-press flex items-center justify-center gap-2"
                style={{ background: tone, color: "#fff" }}
              >
                {state === "loading" ? <><Loader2 size={16} className="animate-spin" /> Sending…</> : confirmLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

// ─── Info sheet ──────────────────────────────────────────────────────────────────

function InfoSheet({
  open,
  onClose,
  restaurantName,
  restaurantLogo,
  locationLabel,
  prepRange,
  qrMode,
  orderingAvailable,
  isRoom,
  onCallWaiter,
  onRequestBill,
  billState,
  callState,
}: {
  open: boolean;
  onClose: () => void;
  restaurantName: string;
  restaurantLogo: string | null;
  locationLabel: string | null;
  prepRange: string | null;
  qrMode: string;
  orderingAvailable: boolean;
  isRoom: boolean;
  onCallWaiter: () => void;
  onRequestBill: () => void;
  billState: NotificationStatus;
  callState: NotificationStatus;
}) {
  return (
    <Sheet open={open} onClose={onClose} maxWidth={440} label="Restaurant info">
      <SheetHeader title={restaurantName} subtitle={locationLabel ?? "Dine-in"} onClose={onClose} icon={<RestaurantLogo name={restaurantName} logoUrl={restaurantLogo} size={40} />} />
      <div className="flex-1 min-h-0 px-5 py-5 flex flex-col gap-3 overflow-y-auto rs-noscroll">
        <div className="grid grid-cols-2 gap-2.5">
          {prepRange && <InfoTile Icon={Timer} label="Avg. prep" value={prepRange} />}
          <InfoTile Icon={ShieldCheck} label="Ordering" value={!orderingAvailable ? "View only" : qrMode === "ordering_no_pin" ? "No PIN needed" : "PIN required"} />
          {locationLabel && <InfoTile Icon={MapPin} label="Seat" value={locationLabel} />}
          <InfoTile Icon={Utensils} label="Service" value={isRoom ? "Room service" : "Dine-in"} />
        </div>

        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={onCallWaiter}
            disabled={!!callState}
            className="flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-medium rs-press"
            style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink)" }}
          >
            <span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(8,145,178,0.1)", color: "var(--color-primary)" }}><ConciergeBell size={18} /></span>
            <span className="flex-1 text-left">
              {isRoom ? "Call staff" : "Call waiter"}
              {callState && <span className="block text-xs" style={{ color: "var(--color-ink-mute)" }}>{callState === "acknowledged" ? "On the way ✓" : "Requested…"}</span>}
            </span>
            <ChevronRight size={16} style={{ color: "var(--color-ink-mute)" }} />
          </button>

          <button
            type="button"
            onClick={onRequestBill}
            disabled={!!billState}
            className="flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-medium rs-press"
            style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink)" }}
          >
            <span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "#0d948815", color: "#0d9488" }}><Receipt size={18} /></span>
            <span className="flex-1 text-left">
              Request bill
              {billState && <span className="block text-xs" style={{ color: "var(--color-ink-mute)" }}>{billState === "acknowledged" ? "Being prepared ✓" : "Requested…"}</span>}
            </span>
            <ChevronRight size={16} style={{ color: "var(--color-ink-mute)" }} />
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function InfoTile({ Icon, label, value }: { Icon: React.ComponentType<{ size?: number }>; label: string; value: string }) {
  return (
    <div className="rounded-2xl px-3.5 py-3 flex flex-col gap-1" style={{ background: "var(--color-canvas-soft)" }}>
      <Icon size={16} />
      <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>{label}</p>
      <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{value}</p>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────────

function EmptyState({ Icon, title, body }: { Icon: React.ComponentType<{ size?: number }>; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-14 px-6">
      <div className="w-16 h-16 rounded-3xl flex items-center justify-center" style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}>
        <Icon size={28} />
      </div>
      <div>
        <p className="text-base" style={{ color: "var(--color-ink)", fontWeight: 500 }}>{title}</p>
        <p className="text-sm mt-1 max-w-[280px]" style={{ color: "var(--color-ink-mute)" }}>{body}</p>
      </div>
    </div>
  );
}

// ─── Item card (text-first, image-free) ──────────────────────────────────────────

// ─── Variant picker ──────────────────────────────────────────────────────────

// "Select Size" / "Select Variation". A dish with variants has no single price,
// so it can't be added straight to the cart — the guest chooses first, and what
// they choose is what they pay.
function VariantSheet({
  item,
  variants,
  cart,
  onAdd,
  onRemove,
  onClose,
}: {
  item: MenuItemRow | null;
  variants: VariantRow[];
  cart: Map<LineKey, number>;
  onAdd: (key: LineKey) => void;
  onRemove: (key: LineKey) => void;
  onClose: () => void;
}) {
  if (!item) return null;

  const chosen = variants.reduce(
    (n, v) => n + (cart.get(keyOf(item.id, v.id)) ?? 0),
    0
  );

  return (
    <Sheet open={!!item} onClose={onClose} maxWidth={440} label={`Choose an option for ${item.name}`}>
      <SheetHeader
        title={item.name}
        subtitle="Choose an option"
        onClose={onClose}
        icon={
          <span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(8,145,178,0.1)" }}>
            <DietMark type={item.food_type as FoodKey} size={16} />
          </span>
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-2 rs-noscroll">
        {variants.map((v) => {
          const key = keyOf(item.id, v.id);
          const qty = cart.get(key) ?? 0;
          return (
            <div
              key={v.id}
              className="flex items-center gap-3 p-3 rounded-2xl border"
              style={{
                background: qty > 0 ? "rgba(8,145,178,0.06)" : "var(--color-canvas-soft)",
                borderColor: qty > 0 ? "var(--color-primary)" : "transparent",
              }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>
                  {v.name}
                </p>
                <p className="text-xs tabular" style={{ color: "var(--color-ink-mute)" }}>
                  {rupee(Number(v.price))}
                </p>
              </div>

              {qty === 0 ? (
                <button
                  type="button"
                  onClick={() => onAdd(key)}
                  className="h-10 px-5 rounded-xl flex items-center gap-1.5 text-sm font-semibold text-white rs-press"
                  style={{ background: "linear-gradient(135deg,var(--color-primary),var(--color-primary-deep))" }}
                >
                  <Plus size={16} /> Add
                </button>
              ) : (
                <div className="h-10 rounded-xl flex items-center gap-1 px-1" style={{ background: "linear-gradient(135deg,var(--color-primary),var(--color-primary-deep))" }}>
                  <button
                    type="button"
                    aria-label={`One less ${v.name}`}
                    onClick={() => onRemove(key)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white rs-press"
                    style={{ background: "rgba(255,255,255,0.18)" }}
                  >
                    <Minus size={16} />
                  </button>
                  <span className="w-7 text-center text-sm font-semibold text-white tabular">{qty}</span>
                  <button
                    type="button"
                    aria-label={`One more ${v.name}`}
                    onClick={() => onAdd(key)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white rs-press"
                    style={{ background: "rgba(255,255,255,0.18)" }}
                  >
                    <Plus size={16} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-4 py-4 border-t" style={{ borderColor: "var(--color-hairline)" }}>
        <button
          type="button"
          onClick={onClose}
          className="w-full py-3.5 rounded-2xl text-sm font-semibold text-white rs-press"
          style={{ background: chosen > 0 ? "linear-gradient(135deg,var(--color-primary),var(--color-primary-deep))" : "var(--color-ink-mute)" }}
        >
          {chosen > 0 ? `Done · ${chosen} added` : "Close"}
        </button>
      </div>
    </Sheet>
  );
}

function ItemCard({
  item,
  categoryName,
  cartQty,
  variants,
  canOrder,
  onAdd,
  onRemove,
}: {
  item: MenuItemRow;
  categoryName: string | null;
  cartQty: number;
  variants: VariantRow[];
  canOrder: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const soldOut = item.availability_status !== "available" || !item.is_available;
  const spicy = isSpicy(item);
  const orderable = canOrder && !soldOut;
  const extraBadges = (item.badges ?? []).filter((b) => !/spic|hot|chilli|chili/i.test(b));

  // With variants there is no single price to show, so the card shows the
  // cheapest as "from ₹X" — the least they could pay — and the real prices live
  // in the picker.
  const hasVariants = variants.length > 0;
  const displayPrice = hasVariants
    ? Math.min(...variants.map((v) => Number(v.price)))
    : Number(item.price);

  return (
    <div
      className="relative flex flex-col rounded-3xl border bg-white rs-card p-4 sm:p-5 rs-fade-up"
      style={{ borderColor: "var(--color-hairline)", opacity: soldOut ? 0.66 : 1 }}
    >
      {/* Header: name (with inline diet mark) · price */}
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 text-[15px] sm:text-base leading-snug" style={{ color: "var(--color-ink)", fontWeight: 600, letterSpacing: "-0.01em" }}>
          <span className="inline-flex align-middle mr-2" style={{ transform: "translateY(-1.5px)" }}>
            <DietMark type={item.food_type as FoodKey} size={13} />
          </span>
          {item.name}
        </h3>
        <span className="shrink-0 text-[15px] sm:text-base tabular" style={{ color: "var(--color-ink)", fontWeight: 600 }}>
          {hasVariants && (
            <span className="text-[11px] font-normal mr-0.5" style={{ color: "var(--color-ink-mute)" }}>
              from
            </span>
          )}
          {rupee(displayPrice)}
        </span>
      </div>
      {item.description && (
        <p className="mt-1.5 text-[13px] leading-relaxed line-clamp-2" style={{ color: "var(--color-ink-mute)" }}>
          {item.description}
        </p>
      )}

      {/* Badge row */}
      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        {item.is_featured && !soldOut && <Pill color="#b45309" bg="#fff7ed" Icon={Sparkles}>Popular</Pill>}
        {spicy && <Pill color="#dc2626" bg="#fef2f2" Icon={Flame}>Spicy</Pill>}
        {extraBadges.slice(0, 2).map((b) => (
          <Pill key={b} color="var(--color-ink-secondary)" bg="var(--color-canvas-soft)">{b}</Pill>
        ))}
        {categoryName && <Pill color="var(--color-primary)" bg="rgba(8,145,178,0.08)">{categoryName}</Pill>}
        {item.preparation_time ? <Pill color="var(--color-ink-mute)" bg="var(--color-canvas-soft)" Icon={Clock}>{item.preparation_time} min</Pill> : null}
      </div>

      {/* Footer: availability · add */}
      <div className="mt-4 pt-3.5 border-t flex items-center justify-between gap-3" style={{ borderColor: "var(--color-hairline)" }}>
        {soldOut ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: "#dc2626" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#dc2626" }} /> Sold out
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: "#0d9488" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#0d9488" }} /> Available
          </span>
        )}

        {!orderable ? (
          !soldOut && canOrder === false ? (
            <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>View only</span>
          ) : null
        ) : /* A dish with variants always reopens the picker — a bare +/- on the
              card would have no variant to apply itself to. */
        hasVariants ? (
          <button
            type="button"
            onClick={onAdd}
            className="h-10 px-5 rounded-xl flex items-center justify-center gap-1.5 text-sm font-semibold text-white rs-press"
            style={{ background: "linear-gradient(135deg,var(--color-primary),var(--color-primary-deep))", boxShadow: "0 6px 16px rgba(8,145,178,0.26)" }}
          >
            {cartQty > 0 ? <>Add more · {cartQty}</> : <>Choose <ChevronRight size={15} /></>}
          </button>
        ) : cartQty === 0 ? (
          <button
            type="button"
            onClick={onAdd}
            className="h-10 px-5 rounded-xl flex items-center justify-center gap-1.5 text-sm font-semibold text-white rs-press"
            style={{ background: "linear-gradient(135deg,var(--color-primary),var(--color-primary-deep))", boxShadow: "0 6px 16px rgba(8,145,178,0.26)" }}
          >
            <Plus size={16} /> Add
          </button>
        ) : (
          <div className="h-10 rounded-xl flex items-center gap-1 px-1 rs-pop" style={{ background: "linear-gradient(135deg,var(--color-primary),var(--color-primary-deep))" }}>
            <button type="button" aria-label="Remove one" onClick={onRemove} className="w-8 h-8 rounded-lg flex items-center justify-center text-white rs-press" style={{ background: "rgba(255,255,255,0.18)" }}>
              <Minus size={16} />
            </button>
            <span className="w-7 text-center text-sm font-semibold text-white tabular">{cartQty}</span>
            <button type="button" aria-label="Add one" onClick={onAdd} className="w-8 h-8 rounded-lg flex items-center justify-center text-white rs-press" style={{ background: "rgba(255,255,255,0.18)" }}>
              <Plus size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Cart drawer ─────────────────────────────────────────────────────────────────

function CartDrawer({
  open,
  onClose,
  entries,
  items,
  variantsOf,
  total,
  count,
  onAdd,
  onRemove,
  onPlace,
  placing,
}: {
  open: boolean;
  onClose: () => void;
  entries: [LineKey, number][];
  items: MenuItemRow[];
  variantsOf: Map<string, VariantRow[]>;
  total: number;
  count: number;
  onAdd: (key: LineKey) => void;
  onRemove: (key: LineKey) => void;
  onPlace: () => void;
  placing: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} maxWidth={480} label="Your cart">
      <SheetHeader
        title="Your cart"
        subtitle={`${count} item${count !== 1 ? "s" : ""}`}
        onClose={onClose}
        icon={<span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(8,145,178,0.1)", color: "var(--color-primary)" }}><ShoppingBag size={18} /></span>}
      />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-2 rs-noscroll">
        {entries.length === 0 ? (
          <EmptyState Icon={ShoppingBag} title="Your cart is empty" body="Browse the menu and add dishes — they'll appear here ready to order." />
        ) : (
          entries.map(([key, qty]) => {
            const { itemId, variantId } = parseKey(key);
            const item = items.find((i) => i.id === itemId);
            if (!item) return null;
            // The variant is what the guest actually chose, so it's what the cart
            // has to show — and its price, not the base item's, is what they pay.
            const variant = variantId
              ? variantsOf.get(itemId)?.find((v) => v.id === variantId) ?? null
              : null;
            const unit = variant ? Number(variant.price) : Number(item.price);
            return (
              <div key={key} className="flex items-center gap-3 p-3 rounded-2xl" style={{ background: "var(--color-canvas-soft)" }}>
                <span className="shrink-0"><DietMark type={item.food_type as FoodKey} /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>{item.name}</p>
                  <p className="text-xs tabular" style={{ color: "var(--color-ink-mute)" }}>
                    {variant && (
                      <span
                        className="mr-1 px-1.5 py-0.5 rounded-md"
                        style={{ background: "rgba(8,145,178,0.1)", color: "var(--color-primary)" }}
                      >
                        {variant.name}
                      </span>
                    )}
                    {rupee(unit)} each
                  </p>
                </div>
                <div className="flex items-center gap-1 rounded-xl p-0.5" style={{ background: "var(--color-canvas)" }}>
                  <button type="button" aria-label="Remove one" onClick={() => onRemove(key)} className="w-8 h-8 rounded-lg flex items-center justify-center rs-press" style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink)" }}>
                    <Minus size={15} />
                  </button>
                  <span className="w-6 text-center text-sm font-semibold tabular" style={{ color: "var(--color-primary)" }}>{qty}</span>
                  <button type="button" aria-label="Add one" onClick={() => onAdd(key)} className="w-8 h-8 rounded-lg flex items-center justify-center text-white rs-press" style={{ background: "var(--color-primary)" }}>
                    <Plus size={15} />
                  </button>
                </div>
                <p className="w-14 text-right text-sm font-semibold tabular" style={{ color: "var(--color-ink)" }}>{rupee(unit * qty)}</p>
              </div>
            );
          })
        )}
      </div>
      {entries.length > 0 && (
        <div className="px-4 py-4 border-t flex flex-col gap-3" style={{ borderColor: "var(--color-hairline)" }}>
          <div className="flex items-center justify-between text-sm">
            <span style={{ color: "var(--color-ink-mute)" }}>Subtotal</span>
            <span className="tabular font-semibold" style={{ color: "var(--color-ink)" }}>{rupee(total)}</span>
          </div>
          <button
            type="button"
            onClick={onPlace}
            disabled={placing}
            className="w-full py-3.5 rounded-2xl flex items-center justify-center gap-2 text-sm font-semibold text-white rs-press"
            style={{ background: "linear-gradient(135deg,var(--color-primary),var(--color-primary-deep))" }}
          >
            {placing ? <><Loader2 size={17} className="animate-spin" /> Placing order…</> : <>Place order · {rupee(total)}</>}
          </button>
        </div>
      )}
    </Sheet>
  );
}

// ─── Bottom navigation ───────────────────────────────────────────────────────────

function BottomNav({
  ordersCount,
  alertCount,
  cartCount,
  onMenu,
  onOrders,
  onCall,
  onAlerts,
  onInfo,
}: {
  ordersCount: number;
  alertCount: number;
  cartCount: number;
  onMenu: () => void;
  onOrders: () => void;
  onCall: () => void;
  onAlerts: () => void;
  onInfo: () => void;
}) {
  const Item = ({ label, Icon, onClick, badge, pulse }: { label: string; Icon: React.ComponentType<{ size?: number }>; onClick: () => void; badge?: number; pulse?: boolean }) => (
    <button
      type="button"
      onClick={onClick}
      className="relative flex flex-col items-center justify-center gap-1 flex-1 h-full rs-press"
      style={{ color: pulse ? "var(--color-primary)" : "var(--color-ink-mute)" }}
    >
      <span className="relative">
        <span className={pulse ? "rs-ring" : ""} style={{ display: "inline-flex" }}><Icon size={21} /></span>
        {!!badge && badge > 0 && (
          <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center" style={{ background: "var(--color-ruby)" }}>
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </span>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 lg:hidden"
      style={{ background: "rgba(255,255,255,0.86)", backdropFilter: "blur(14px)", borderTop: "1px solid var(--color-hairline)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto max-w-lg h-16 flex items-stretch relative">
        <Item label="Menu" Icon={Home} onClick={onMenu} />
        <Item label="Orders" Icon={ClipboardList} onClick={onOrders} badge={ordersCount} />
        <div className="flex-1 flex items-start justify-center">
          <button
            type="button"
            onClick={onCall}
            aria-label="Call waiter"
            className="-mt-5 w-14 h-14 rounded-full flex items-center justify-center text-white rs-press rs-pulse-ring"
            style={{ background: "linear-gradient(135deg,var(--color-primary),var(--color-primary-deep))", boxShadow: "0 10px 24px rgba(8,145,178,0.4)" }}
          >
            <ConciergeBell size={22} />
          </button>
        </div>
        <Item label="Alerts" Icon={Bell} onClick={onAlerts} badge={alertCount} pulse={alertCount > 0} />
        <Item label="Info" Icon={Info} onClick={onInfo} badge={cartCount} />
      </div>
    </nav>
  );
}

// ─── Table activation (no-PIN) status sheet ──────────────────────────────────────

function ActivationSheet({
  open,
  status,
  locationLabel,
  isRoom,
  onClose,
}: {
  open: boolean;
  status: ActivationStatus;
  locationLabel: string | null;
  isRoom: boolean;
  onClose: () => void;
}) {
  const pending = status === "pending";
  return (
    <Sheet open={open} onClose={onClose} maxWidth={400} label="Table activation">
      <div className="px-6 pt-3 pb-7 flex flex-col items-center text-center gap-4">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center rs-float"
          style={{
            background: pending ? "rgba(8,145,178,0.12)" : "#fef2f2",
            color: pending ? "var(--color-primary)" : "#dc2626",
          }}
        >
          {pending ? <Hourglass size={30} /> : <XCircle size={30} />}
        </div>
        <div>
          <p className="text-lg" style={{ color: "var(--color-ink)", fontWeight: 500 }}>
            {pending ? "Waiting for approval" : "Request declined"}
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--color-ink-mute)" }}>
            {pending
              ? `Your order for ${locationLabel ?? (isRoom ? "your room" : "your table")} has been sent to the staff. They'll activate your table in a moment — this page updates automatically.`
              : `Your table activation request was declined. Please contact ${isRoom ? "the front desk" : "a staff member"} for assistance.`}
          </p>
        </div>
        {pending && (
          <p className="text-sm flex items-center gap-1.5" style={{ color: "var(--color-primary)" }}>
            <Loader2 size={14} className="animate-spin" /> Awaiting staff…
          </p>
        )}
        <button
          type="button"
          onClick={onClose}
          className="w-full h-12 rounded-2xl text-sm font-medium rs-press"
          style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink)" }}
        >
          {pending ? "Continue browsing" : "OK"}
        </button>
      </div>
    </Sheet>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────────

export function CustomerMenu({
  restaurantId,
  restaurantName,
  restaurantLogo = null,
  tableId,
  tableNumber,
  roomId,
  roomNumber,
  sessionId: initialSessionId,
  orderingEnabled,
  qrMode,
  categories,
  items,
  variants,
  initialNotifState,
  initialActivationStatus,
}: {
  restaurantId: string;
  restaurantName: string;
  restaurantLogo?: string | null;
  tableId: string | null;
  tableNumber: string | null;
  roomId: string | null;
  roomNumber: string | null;
  sessionId: string | null;
  orderingEnabled: boolean;
  qrMode: string;
  categories: CategoryRow[];
  items: MenuItemRow[];
  variants: VariantRow[];
  initialNotifState: CustomerNotifState;
  initialActivationStatus: ActivationStatus;
}) {
  const isRoom = !!roomId;
  const contextId = tableId ?? roomId ?? null;
  const locationLabel = tableNumber ? `Table ${tableNumber}` : roomNumber ? `Room ${roomNumber}` : null;
  const noPin = qrMode === "ordering_no_pin";

  const [activeSessionId, setActiveSessionId] = useState<string | null>(initialSessionId);
  const orderingAvailable = orderingEnabled && (qrMode === "ordering_enabled" || noPin) && !!contextId;

  // No-PIN table activation: 'none' (not requested yet), 'pending' (awaiting
  // staff), 'approved' (activated → order flows normally), 'rejected' (declined).
  const [activationStatus, setActivationStatus] = useState<ActivationStatus>(initialActivationStatus);
  const activationRef = useRef<ActivationStatus>(initialActivationStatus);
  const [showActivationSheet, setShowActivationSheet] = useState(
    noPin && (initialActivationStatus === "pending" || initialActivationStatus === "rejected")
  );
  const setActivation = useCallback((s: ActivationStatus) => {
    activationRef.current = s;
    setActivationStatus(s);
  }, []);

  // In no-PIN mode, ordering interactions pause while a table activation request
  // is pending (order already sent) or after it's been rejected (needs staff).
  const activationBlocks = noPin && (activationStatus === "pending" || activationStatus === "rejected");
  const canOrderNow = orderingAvailable && !activationBlocks;

  // Opens on "All", so a guest sees the whole menu — grouped by category — before
  // they narrow it down.
  const [activeCategoryId, setActiveCategoryId] = useState<string>(ALL_CATEGORY_ID);
  const [pinVerified, setPinVerified] = useState(noPin);
  const [showPinEntry, setShowPinEntry] = useState(false);
  // Keyed by item AND variant — a Large Coffee and a Small Coffee are two lines.
  const [cart, setCart] = useState<Map<LineKey, number>>(new Map());
  const [pendingAddItemId, setPendingAddItemId] = useState<string | null>(null);
  // The item whose variant sheet is open ("Choose a size").
  const [picking, setPicking] = useState<MenuItemRow | null>(null);
  const [placing, setPlacing] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);

  const variantsOf = useMemo(() => {
    const m = new Map<string, VariantRow[]>();
    for (const v of variants) {
      const list = m.get(v.menu_item_id);
      if (list) list.push(v);
      else m.set(v.menu_item_id, [v]);
    }
    return m;
  }, [variants]);

  // Overlays
  const [showCart, setShowCart] = useState(false);
  const [showOrders, setShowOrders] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");

  // Live tracking + alerts
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenReadyRef = useRef<Set<string>>(new Set());
  // Set by the polling effect below; called by the realtime stream.
  const pollRef = useRef<null | (() => void)>(null);

  // The customer's phone is pushed to as well: an order going ready, a waiter
  // acknowledging the call, the table being activated, or the menu changing all
  // land instantly. Scoped by session id — the stream carries only topic names,
  // so an unauthenticated guest can never receive data they shouldn't see.
  useRealtime(
    ["orders", "notifications", "tables", "menu"],
    useCallback(() => pollRef.current?.(), []),
    activeSessionId
  );

  // Service requests
  const [serviceNotif, setServiceNotif] = useState<CustomerNotifState>(initialNotifState);
  const prevServiceRef = useRef<CustomerNotifState>(initialNotifState);
  const [, startNotify] = useTransition();

  // Action dialogs
  const [callDialog, setCallDialog] = useState<"idle" | "loading" | "success" | null>(null);
  const [billDialog, setBillDialog] = useState<"idle" | "loading" | "success" | null>(null);

  const cacheKey = contextId ?? "";

  // (The workstation map that used to live here is gone: the guest's phone no
  // longer tells the server which kitchen station a dish routes to — the server
  // reads that off the menu item, along with the name and the price.)
  const categoryNameMap = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const prepRange = useMemo(() => {
    const times = items.map((i) => i.preparation_time).filter((t): t is number => !!t);
    if (times.length === 0) return null;
    const lo = Math.min(...times);
    const hi = Math.max(...times);
    return lo === hi ? `${lo} min` : `${lo}–${hi} min`;
  }, [items]);

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { ...t, id }].slice(-3));
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 7000);
  }, []);

  // Restore PIN auth from localStorage
  useEffect(() => {
    if (!contextId || noPin) return;
    try {
      const stored = localStorage.getItem(`rs_auth_${cacheKey}`);
      if (!stored) return;
      const parsed = JSON.parse(stored) as { sessionId?: string };
      if (!parsed.sessionId) return;
      checkSessionActive(parsed.sessionId).then((r) => {
        if (r.active) {
          setActiveSessionId(parsed.sessionId!);
          setPinVerified(true);
        } else {
          localStorage.removeItem(`rs_auth_${cacheKey}`);
        }
      });
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live poll: order feed + ready alerts + service-request acknowledgement.
  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        // ── No-PIN activation state ── detect approve/reject transitions.
        if (noPin && contextId) {
          const st = await getCustomerActivationState(restaurantId, tableId, roomId, activeSessionId);
          if (!active) return;
          if (st.sessionId && st.sessionId !== activeSessionId) setActiveSessionId(st.sessionId);
          const prevAct = activationRef.current;
          if (st.status !== prevAct) {
            activationRef.current = st.status;
            setActivationStatus(st.status);
            if (prevAct === "pending" && st.status === "approved") {
              setShowActivationSheet(false);
              pushToast({ tone: "success", title: "Table activated", body: "Your order is on its way to the kitchen", Icon: CheckCircle2 });
            }
            if (st.status === "rejected") {
              setShowActivationSheet(true);
            }
          }
        }

        // The held (pending) order must NOT surface as "in the kitchen" — only
        // pull the live order feed once the table is actually active.
        const feedVisible = !noPin || activationRef.current === "approved";
        if (activeSessionId && feedVisible) {
          const feed = await getCustomerOrderFeed(activeSessionId);
          if (!active) return;
          setOrders(feed.orders);

          // "Order ready" surfaces in a single place — the Alerts bell (badge +
          // ringing + notification-center entry). No toast/header duplication.
          // We still acknowledge server-side so the alert doesn't accumulate.
          const fresh = feed.ready.filter((r) => !seenReadyRef.current.has(r.id));
          if (fresh.length > 0) {
            fresh.forEach((r) => seenReadyRef.current.add(r.id));
            acknowledgeCustomerReady(activeSessionId, fresh.map((r) => r.id)).catch(() => {});
          }
        } else if (noPin && activationRef.current !== "approved") {
          setOrders([]);
        }

        if (contextId) {
          const ns = await getCustomerNotifState(restaurantId, tableId, roomId, activeSessionId);
          if (!active) return;
          const prev = prevServiceRef.current;
          if (prev.call_waiter !== "acknowledged" && ns.call_waiter === "acknowledged") {
            pushToast({ tone: "primary", title: isRoom ? "Staff is on the way" : "Your waiter is on the way", body: "Hang tight — someone's coming over", Icon: ConciergeBell });
          }
          if (prev.request_bill !== "acknowledged" && ns.request_bill === "acknowledged") {
            pushToast({ tone: "info", title: "Your bill is being prepared", body: "It'll be with you shortly", Icon: Receipt });
          }
          prevServiceRef.current = ns;
          setServiceNotif(ns);
        }
      } catch {
        /* transient — keep last state */
      }
    }

    // Hand the poller to the realtime stream, so a kitchen update / waiter
    // acknowledgement reaches the customer's phone the moment it happens.
    pollRef.current = poll;

    poll();
    const iv = setInterval(poll, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      pollRef.current = null;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, contextId, restaurantId, tableId, roomId]);

  // ── Cart ──
  const addByKey = useCallback((key: LineKey) => {
    setCart((prev) => {
      const next = new Map(prev);
      next.set(key, Math.min((next.get(key) ?? 0) + 1, 99));
      return next;
    });
  }, []);

  const removeByKey = useCallback((key: LineKey) => {
    setCart((prev) => {
      const next = new Map(prev);
      const qty = (next.get(key) ?? 0) - 1;
      if (qty <= 0) next.delete(key);
      else next.set(key, qty);
      return next;
    });
  }, []);

  // Tapping Add on a dish with variants can't add anything yet — which one, and
  // at what price, isn't known until the guest chooses. It opens the sheet.
  const handleAdd = useCallback(
    (item: MenuItemRow) => {
      if (!canOrderNow) return;
      if (item.availability_status !== "available" || !item.is_available) return;
      if (!pinVerified) {
        // Hold the tap: once the PIN lands we resume exactly where they were,
        // sheet included.
        setPendingAddItemId(item.id);
        setShowPinEntry(true);
        return;
      }
      if (variantsOf.get(item.id)?.length) {
        setPicking(item);
        return;
      }
      addByKey(keyOf(item.id, null));
    },
    [canOrderNow, pinVerified, variantsOf, addByKey]
  );

  const handlePinSuccess = useCallback(
    (resolvedSessionId: string) => {
      setActiveSessionId(resolvedSessionId);
      setPinVerified(true);
      setShowPinEntry(false);
      if (pendingAddItemId) {
        const item = items.find((i) => i.id === pendingAddItemId);
        if (item && variantsOf.get(item.id)?.length) setPicking(item);
        else addByKey(keyOf(pendingAddItemId, null));
        setPendingAddItemId(null);
      }
    },
    [pendingAddItemId, addByKey, items, variantsOf]
  );

  // Price and label for a cart line — from the chosen variant when there is one.
  // These are for DISPLAY only; the bill is priced from the menu server-side.
  const priceOfLine = useCallback(
    (itemId: string, variantId: string | null): number => {
      if (variantId) {
        const v = variantsOf.get(itemId)?.find((x) => x.id === variantId);
        if (v) return Number(v.price);
      }
      return Number(items.find((i) => i.id === itemId)?.price ?? 0);
    },
    [items, variantsOf]
  );

  const cartEntries = Array.from(cart.entries());
  const cartTotal = cartEntries.reduce((sum, [key, qty]) => {
    const { itemId, variantId } = parseKey(key);
    return sum + priceOfLine(itemId, variantId) * qty;
  }, 0);
  const cartCount = cartEntries.reduce((sum, [, qty]) => sum + qty, 0);

  // How many of this dish are in the cart across every variant of it.
  const qtyOfItem = useCallback(
    (itemId: string): number => {
      let total = 0;
      for (const [key, qty] of cart) {
        if (parseKey(key).itemId === itemId) total += qty;
      }
      return total;
    },
    [cart]
  );

  function buildOrderItems(): CustomerCartItem[] {
    // Ids and quantities only. The server looks up the name and the price.
    return cartEntries.map(([key, quantity]) => {
      const { itemId, variantId } = parseKey(key);
      return { menu_item_id: itemId, variant_id: variantId, quantity };
    });
  }

  async function placeOrder() {
    if (cartCount === 0) return;
    if (noPin && activationStatus === "rejected") return; // ordering blocked until staff help
    setPlacing(true);

    const orderItems = buildOrderItems();

    // ── No-PIN: route through the staff activation gate ──
    // requestTableActivation handles both cases: if the table is already active
    // (staff approved / opened it) the order flows straight to the kitchen;
    // otherwise it opens a pending session and raises an activation request.
    if (noPin) {
      const res = await requestTableActivation(restaurantId, tableId, roomId, orderItems);
      setPlacing(false);
      if (res.status === "error") {
        pushToast({ tone: "info", title: "Couldn't send your order", body: res.error ?? "Please try again", Icon: Info });
        return;
      }
      if (res.sessionId) setActiveSessionId(res.sessionId);
      setCart(new Map());
      setShowCart(false);

      if (res.status === "approved") {
        setActivation("approved");
        setOrderSuccess(true);
        pushToast({ tone: "success", title: "Order placed", body: "The kitchen has your order — track it live in Orders", Icon: CheckCircle2, desktopOnly: true });
        if (res.sessionId) getCustomerOrderFeed(res.sessionId).then((f) => setOrders(f.orders)).catch(() => {});
        setTimeout(() => setOrderSuccess(false), 4000);
      } else {
        // pending — waiting for a staff member to activate the table
        setActivation("pending");
        setShowActivationSheet(true);
      }
      return;
    }

    // ── With-PIN: order goes straight through the verified session ──
    const sid = activeSessionId;
    if (!sid) {
      setPlacing(false);
      pushToast({ tone: "info", title: "Couldn't start your order", body: "Please refresh and try again", Icon: Info });
      return;
    }

    const result = await submitCustomerOrder(sid, restaurantId, orderItems);
    if (result.error) {
      pushToast({ tone: "info", title: "Order failed", body: result.error, Icon: Info });
    } else {
      setCart(new Map());
      setShowCart(false);
      setOrderSuccess(true);
      // Desktop-only: on mobile the bottom success bar is the single confirmation
      // (avoids a duplicate top toast + bottom bar). Desktop has no bottom bar.
      pushToast({ tone: "success", title: "Order placed", body: "The kitchen has your order — track it live in Orders", Icon: CheckCircle2, desktopOnly: true });
      getCustomerOrderFeed(sid).then((f) => setOrders(f.orders)).catch(() => {});
      setTimeout(() => setOrderSuccess(false), 4000);
    }
    setPlacing(false);
  }

  // ── Service requests ──
  function runServiceRequest(type: "call_waiter" | "request_bill") {
    if (serviceNotif[type]) return;
    const setDialog = type === "call_waiter" ? setCallDialog : setBillDialog;
    setDialog("loading");
    startNotify(async () => {
      const result = await sendNotification(restaurantId, tableId, type, roomId);
      if (!result?.error) {
        setServiceNotif((prev) => ({ ...prev, [type]: "new" }));
        prevServiceRef.current = { ...prevServiceRef.current, [type]: "new" };
        setDialog("success");
        setTimeout(() => setDialog(null), 1600);
      } else {
        setDialog(null);
        pushToast({ tone: "info", title: "Couldn't send request", body: result.error, Icon: Info });
      }
    });
  }

  function openCall() {
    if (serviceNotif.call_waiter) { setShowInfo(true); return; }
    setCallDialog("idle");
  }
  function openBill() {
    if (serviceNotif.request_bill) { setShowOrders(true); return; }
    setBillDialog("idle");
  }

  // ── Derived: notifications feed + badges ──
  const notifEntries: NotifEntry[] = useMemo(() => {
    const list: NotifEntry[] = [];
    for (const o of orders) {
      const time = new Date(o.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      const meta = ORDER_STATUS_META[o.status];
      const body = `${o.items.reduce((n, i) => n + i.quantity, 0)} item${o.items.length !== 1 ? "s" : ""} · ${rupee(o.total)}`;
      list.push({
        id: `order-${o.id}`,
        title: o.status === "ready" ? "Order ready to serve" : o.status === "served" ? "Order served" : "Order in the kitchen",
        body,
        time,
        tone: o.status === "ready" ? "success" : o.status === "served" ? "neutral" : "warning",
        Icon: meta.Icon,
      });
    }
    if (serviceNotif.call_waiter) {
      list.unshift({
        id: "svc-waiter",
        title: serviceNotif.call_waiter === "acknowledged" ? (isRoom ? "Staff on the way" : "Waiter on the way") : (isRoom ? "Staff requested" : "Waiter requested"),
        body: serviceNotif.call_waiter === "acknowledged" ? "Someone's heading to you" : "Waiting for staff to respond",
        time: "now",
        tone: "primary",
        Icon: ConciergeBell,
      });
    }
    if (serviceNotif.request_bill) {
      list.unshift({
        id: "svc-bill",
        title: serviceNotif.request_bill === "acknowledged" ? "Bill being prepared" : "Bill requested",
        body: serviceNotif.request_bill === "acknowledged" ? "Your bill will arrive shortly" : "Waiting for staff to respond",
        time: "now",
        tone: "success",
        Icon: Receipt,
      });
    }
    return list;
  }, [orders, serviceNotif, isRoom]);

  const readyCount = orders.filter((o) => o.status === "ready").length;
  const activeOrderCount = orders.filter((o) => o.status !== "served").length;
  const pendingServiceCount = (serviceNotif.call_waiter === "new" ? 1 : 0) + (serviceNotif.request_bill === "new" ? 1 : 0);
  const alertCount = readyCount + pendingServiceCount;

  // ── Items shown ──
  const searchActive = query.trim().length > 0;
  const showingAll = !searchActive && activeCategoryId === ALL_CATEGORY_ID;

  const visibleItems = useMemo(() => {
    if (searchActive) {
      const q = query.trim().toLowerCase();
      return items.filter((i) => i.name.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q));
    }
    if (activeCategoryId === ALL_CATEGORY_ID) return items;
    return items.filter((i) => i.category_id === activeCategoryId);
  }, [items, activeCategoryId, query, searchActive]);

  // "All" keeps the category STRUCTURE rather than dumping every dish into one
  // list — the guest still learns how the menu is organised. Built by walking
  // `categories`, which arrives in the admin's order, so the sections inherit it
  // for free; empty categories drop out rather than render a bare heading.
  const groupedItems = useMemo(() => {
    if (!showingAll) return [];
    return categories
      .map((c) => ({ category: c, items: items.filter((i) => i.category_id === c.id) }))
      .filter((g) => g.items.length > 0);
  }, [showingAll, categories, items]);

  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.category_id, (m.get(i.category_id) ?? 0) + 1);
    return m;
  }, [items]);

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setShowSearch(false);
    setQuery("");
  }

  const showCartBar = canOrderNow && cartCount > 0;

  return (
    <div
      className="min-h-screen overflow-x-hidden"
      // Green-blue accent scoped to the customer page only — leaves the rest of the
      // app's indigo brand (--color-primary) untouched. Cyan primary + teal success.
      style={{
        background: "var(--color-canvas-soft)",
        "--color-primary": "#0891b2",
        "--color-primary-deep": "#0e7490",
        "--color-primary-soft": "#22d3ee",
        "--color-brand-dark": "#0b3a47",
      } as React.CSSProperties}
    >
      <AnimationStyles />

      {/* Toasts */}
      <ToastStack
        toasts={toasts}
        onOpen={(t) => setToasts((p) => p.filter((x) => x.id !== t.id))}
        onClose={(id) => setToasts((p) => p.filter((x) => x.id !== id))}
      />

      {/* PIN entry */}
      {showPinEntry && orderingAvailable && contextId && (
        <PinEntry
          sessionId={activeSessionId}
          tableId={tableId}
          roomId={roomId}
          cacheKey={cacheKey}
          isRoom={isRoom}
          onSuccess={handlePinSuccess}
          onClose={() => { setShowPinEntry(false); setPendingAddItemId(null); }}
        />
      )}

      {/* No-PIN table activation status */}
      {noPin && (
        <ActivationSheet
          open={showActivationSheet && (activationStatus === "pending" || activationStatus === "rejected")}
          status={activationStatus}
          locationLabel={locationLabel}
          isRoom={isRoom}
          onClose={() => setShowActivationSheet(false)}
        />
      )}

      {/* Header */}
      <header
        className="sticky top-0 z-40"
        style={{ background: "rgba(255,255,255,0.82)", backdropFilter: "blur(16px)", borderBottom: "1px solid var(--color-hairline)" }}
      >
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
          <RestaurantLogo name={restaurantName} logoUrl={restaurantLogo} size={38} priority />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-tight truncate" style={{ color: "var(--color-ink)" }}>{restaurantName}</p>
            {locationLabel && (
              <span className="inline-flex items-center gap-1 text-[11px] mt-0.5 px-1.5 py-0.5 rounded-md" style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}>
                <MapPin size={10} /> {locationLabel}
              </span>
            )}
          </div>

          <button
            type="button"
            aria-label="Search menu"
            onClick={() => { setShowSearch((s) => !s); if (showSearch) setQuery(""); }}
            className="w-10 h-10 rounded-full flex items-center justify-center rs-press"
            style={{ background: showSearch ? "var(--color-primary)" : "var(--color-canvas-soft)", color: showSearch ? "#fff" : "var(--color-ink)" }}
          >
            <Search size={18} />
          </button>
          {/* Desktop-only notification bell — on mobile/tablet the bottom-nav "Alerts"
              is the single place notifications surface (no bottom nav on lg). */}
          <button
            type="button"
            aria-label="Notifications"
            onClick={() => setShowNotifs(true)}
            className="relative w-10 h-10 rounded-full hidden lg:flex items-center justify-center rs-press"
            style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink)" }}
          >
            <Bell size={18} className={alertCount > 0 ? "rs-ring" : ""} />
            {alertCount > 0 && (
              <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center" style={{ background: "var(--color-ruby)" }}>
                {alertCount > 9 ? "9+" : alertCount}
              </span>
            )}
          </button>

          {orderingAvailable && (
            <button
              type="button"
              onClick={() => setShowCart(true)}
              className="hidden lg:flex items-center gap-2 h-10 px-4 rounded-full text-sm font-medium text-white rs-press"
              style={{ background: "linear-gradient(135deg,var(--color-primary),var(--color-primary-deep))" }}
            >
              <ShoppingBag size={16} /> {cartCount > 0 ? `${cartCount} · ${rupee(cartTotal)}` : "Cart"}
            </button>
          )}
        </div>

        {showSearch && (
          <div className="mx-auto max-w-6xl px-4 pb-3 rs-fade">
            <div className="flex items-center gap-2 h-11 px-3.5 rounded-2xl" style={{ background: "var(--color-canvas-soft)", border: "1px solid var(--color-hairline)" }}>
              <Search size={17} style={{ color: "var(--color-ink-mute)" }} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search dishes…"
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: "var(--color-ink)" }}
              />
              {query && (
                <button type="button" aria-label="Clear" onClick={() => setQuery("")} style={{ color: "var(--color-ink-mute)" }}>
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4" style={{ paddingBottom: showCartBar ? 168 : 96 }}>
        {/* No-PIN activation banner — tap to reopen the status sheet */}
        {noPin && (activationStatus === "pending" || activationStatus === "rejected") && (
          <button
            type="button"
            onClick={() => setShowActivationSheet(true)}
            className="mt-4 w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left rs-press rs-fade"
            style={
              activationStatus === "pending"
                ? { background: "rgba(8,145,178,0.08)", border: "1px solid rgba(8,145,178,0.3)" }
                : { background: "#fef2f2", border: "1px solid #dc262633" }
            }
          >
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={
                activationStatus === "pending"
                  ? { background: "rgba(8,145,178,0.14)", color: "var(--color-primary)" }
                  : { background: "#fee2e2", color: "#dc2626" }
              }
            >
              {activationStatus === "pending" ? <Hourglass size={17} /> : <XCircle size={17} />}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                {activationStatus === "pending" ? "Waiting for staff to activate your table" : "Table activation declined"}
              </span>
              <span className="block text-xs" style={{ color: "var(--color-ink-mute)" }}>
                {activationStatus === "pending" ? "Your order has been sent — hang tight" : `Please contact ${isRoom ? "the front desk" : "a staff member"}`}
              </span>
            </span>
            <ChevronRight size={16} style={{ color: "var(--color-ink-mute)" }} />
          </button>
        )}

        {/* Hero — branding, no imagery */}
        {!searchActive && (
          <section className="mt-4">
            <div
              className="relative overflow-hidden rounded-3xl px-5 py-6 sm:px-8 sm:py-7 rs-elev"
              style={{ background: "linear-gradient(140deg,var(--color-brand-dark),var(--color-primary) 150%)" }}
            >
              <div className="absolute -top-16 -right-10 w-52 h-52 rounded-full" style={{ background: "radial-gradient(circle, rgba(45,212,191,0.42), transparent 70%)" }} />
              <div className="absolute -bottom-20 -left-10 w-56 h-56 rounded-full" style={{ background: "radial-gradient(circle, rgba(34,211,238,0.4), transparent 70%)" }} />

              <div className="relative">
                <div className="flex items-center gap-3">
                  {/* variant="plain" — the hero is already a brand gradient, so the
                      logo plate must not stack a second one on top of it. */}
                  <RestaurantLogo
                    name={restaurantName}
                    logoUrl={restaurantLogo}
                    size={44}
                    variant="plain"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "0.14em" }}>Welcome</p>
                    <h1 className="text-xl sm:text-2xl leading-tight truncate" style={{ color: "#fff", fontWeight: 600, letterSpacing: "-0.5px" }}>{restaurantName}</h1>
                  </div>
                  {locationLabel && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-xl shrink-0" style={{ background: "rgba(255,255,255,0.16)", color: "#fff" }}>
                      <MapPin size={13} /> {locationLabel}
                    </span>
                  )}
                </div>

                <p className="mt-3 text-sm max-w-md" style={{ color: "rgba(255,255,255,0.8)" }}>
                  Thoughtfully prepared, made to order — browse the menu and order right from your {isRoom ? "room" : "table"}.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {prepRange && <HeroChip Icon={Timer}>Avg {prepRange}</HeroChip>}
                  <HeroChip Icon={ShieldCheck}>{!orderingAvailable ? "Menu only" : noPin ? "Order instantly — no PIN" : "PIN to order"}</HeroChip>
                  {activeOrderCount > 0 && <HeroChip Icon={ChefHat}>{activeOrderCount} order{activeOrderCount !== 1 ? "s" : ""} cooking</HeroChip>}
                  <HeroChip Icon={Utensils}>{isRoom ? "Room service" : "Dine-in"}</HeroChip>
                </div>

                {orderingAvailable && !pinVerified && !noPin && (
                  <button
                    type="button"
                    onClick={() => setShowPinEntry(true)}
                    className="mt-4 inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-2xl rs-press"
                    style={{ background: "#fff", color: "var(--color-primary)" }}
                  >
                    <Lock size={15} /> Enter PIN to start ordering
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Category chips (sticky) */}
        {!searchActive && categories.length > 0 && (
          <div className="sticky z-30 -mx-4 px-4 py-2.5 mt-4" style={{ top: showSearch ? 128 : 66, background: "linear-gradient(var(--color-canvas-soft) 70%, transparent)" }}>
            <div className="flex gap-2 overflow-x-auto rs-noscroll" style={{ WebkitOverflowScrolling: "touch" }}>
              {/* "All" leads, then the admin's own order — the array is never sorted
                  here, so whatever the admin arranges is what the guest sees. */}
              {[{ id: ALL_CATEGORY_ID, name: "All" }, ...categories].map((c) => {
                const isAll = c.id === ALL_CATEGORY_ID;
                const CatIcon = isAll ? LayoutGrid : iconForCategory(c.name);
                const active = activeCategoryId === c.id;
                const count = isAll ? items.length : categoryCounts.get(c.id) ?? 0;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveCategoryId(c.id)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl whitespace-nowrap shrink-0 text-sm rs-press"
                    style={{
                      background: active ? "var(--color-ink)" : "var(--color-canvas)",
                      color: active ? "#fff" : "var(--color-ink-secondary)",
                      border: `1px solid ${active ? "var(--color-ink)" : "var(--color-hairline)"}`,
                      fontWeight: active ? 500 : 400,
                      boxShadow: active ? "0 6px 16px rgba(13,37,61,0.18)" : "none",
                    }}
                  >
                    <CatIcon size={15} />
                    {c.name}
                    <span className="text-[11px] px-1.5 rounded-full" style={{ background: active ? "rgba(255,255,255,0.2)" : "var(--color-canvas-soft)", color: active ? "#fff" : "var(--color-ink-mute)" }}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Section title */}
        <div className="flex items-center justify-between mt-4 mb-3">
          <h2 className="text-lg" style={{ color: "var(--color-ink)", fontWeight: 600, letterSpacing: "-0.3px" }}>
            {searchActive
              ? `Results for "${query.trim()}"`
              : showingAll
              ? "Full menu"
              : categories.find((c) => c.id === activeCategoryId)?.name ?? "Menu"}
          </h2>
          <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>{visibleItems.length} item{visibleItems.length !== 1 ? "s" : ""}</span>
        </div>

        {/* Items */}
        {visibleItems.length === 0 ? (
          <EmptyState
            Icon={searchActive ? Search : UtensilsCrossed}
            title={searchActive ? "No dishes found" : "Nothing here yet"}
            body={searchActive ? "Try a different search term or browse the categories." : "This category has no items right now."}
          />
        ) : showingAll ? (
          /* "All" — every dish, still grouped under its category heading, in the
             admin's order. The `key` re-mounts on switch so the fade-in replays. */
          <div key="all" className="flex flex-col gap-7">
            {groupedItems.map(({ category, items: catItems }) => {
              const CatIcon = iconForCategory(category.name);
              return (
                <section key={category.id}>
                  <div className="flex items-center gap-2 mb-3">
                    {/* `iconForCategory` returns a component that only takes `size`,
                        so the colour is applied by the wrapper. */}
                    <span className="flex items-center" style={{ color: "var(--color-ink-mute)" }}>
                      <CatIcon size={16} />
                    </span>
                    <h3 className="text-base" style={{ color: "var(--color-ink)", fontWeight: 600, letterSpacing: "-0.2px" }}>
                      {category.name}
                    </h3>
                    <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                      {catItems.length}
                    </span>
                    {/* A hairline that fills the row, so each group reads as its own
                        block on a long scroll without shouting. */}
                    <span className="flex-1 h-px ml-1" style={{ background: "var(--color-hairline)" }} />
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
                    {catItems.map((item) => (
                      <ItemCard
                        key={item.id}
                        item={item}
                        // The heading above already names the category — repeating it
                        // on every card would be noise.
                        categoryName={null}
                        cartQty={qtyOfItem(item.id)}
                        variants={variantsOf.get(item.id) ?? []}
                        canOrder={canOrderNow}
                        onAdd={() => handleAdd(item)}
                        onRemove={() => removeByKey(keyOf(item.id, null))}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div key={searchActive ? "search" : activeCategoryId} className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
            {visibleItems.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                categoryName={searchActive ? (categoryNameMap.get(item.category_id) ?? null) : null}
                cartQty={qtyOfItem(item.id)}
                variants={variantsOf.get(item.id) ?? []}
                canOrder={canOrderNow}
                onAdd={() => handleAdd(item)}
                onRemove={() => removeByKey(keyOf(item.id, null))}
              />
            ))}
          </div>
        )}

        {contextId && !orderingAvailable && (
          <div className="mt-5 flex items-center gap-2 text-sm px-4 py-3 rounded-2xl" style={{ background: "var(--color-canvas)", border: "1px solid var(--color-hairline)", color: "var(--color-ink-mute)" }}>
            <Lock size={15} />
            View-only menu — ask {isRoom ? "the front desk" : "your waiter"} to place your order.
          </div>
        )}
      </main>

      {/* Floating cart bar (mobile & tablet) */}
      {showCartBar && (
        <div className="fixed left-0 right-0 z-40 px-4 lg:hidden" style={{ bottom: `calc(72px + env(safe-area-inset-bottom))` }}>
          <button
            type="button"
            onClick={() => setShowCart(true)}
            className="mx-auto max-w-lg w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-white rs-press rs-slide-up rs-elev-lg"
            style={{ background: "linear-gradient(135deg,var(--color-primary),var(--color-primary-deep))" }}
          >
            <span className="relative w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.18)" }}>
              <ShoppingBag size={18} />
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: "#fff", color: "var(--color-primary)" }}>{cartCount}</span>
            </span>
            <span className="flex-1 text-left">
              <span className="block text-xs" style={{ color: "rgba(255,255,255,0.8)" }}>{cartCount} item{cartCount !== 1 ? "s" : ""} in cart</span>
              <span className="block text-sm font-semibold tabular">{rupee(cartTotal)}</span>
            </span>
            <span className="flex items-center gap-1 text-sm font-medium">View cart <ChevronRight size={16} /></span>
          </button>
        </div>
      )}

      {orderSuccess && !showCartBar && (
        <div className="fixed left-0 right-0 z-40 px-4 lg:hidden" style={{ bottom: `calc(72px + env(safe-area-inset-bottom))` }}>
          <div className="mx-auto max-w-lg flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-white rs-slide-up" style={{ background: "linear-gradient(135deg,#0d9488,#15b981)" }}>
            <CheckCircle2 size={17} /> <span className="text-sm font-medium">Order placed — we&apos;re on it</span>
          </div>
        </div>
      )}

      {/* Bottom nav */}
      {contextId && (
        <BottomNav
          ordersCount={activeOrderCount}
          alertCount={alertCount}
          cartCount={cartCount}
          onMenu={scrollToTop}
          onOrders={() => setShowOrders(true)}
          onCall={openCall}
          onAlerts={() => setShowNotifs(true)}
          onInfo={() => setShowInfo(true)}
        />
      )}

      {/* Overlays */}
      <VariantSheet
        item={picking}
        variants={picking ? variantsOf.get(picking.id) ?? [] : []}
        cart={cart}
        onAdd={addByKey}
        onRemove={removeByKey}
        onClose={() => setPicking(null)}
      />

      <CartDrawer
        open={showCart}
        onClose={() => setShowCart(false)}
        entries={cartEntries}
        items={items}
        variantsOf={variantsOf}
        total={cartTotal}
        count={cartCount}
        onAdd={addByKey}
        onRemove={removeByKey}
        onPlace={placeOrder}
        placing={placing}
      />

      <OrdersSheet open={showOrders} orders={orders} onClose={() => setShowOrders(false)} onRequestBill={openBill} billState={serviceNotif.request_bill} />

      <NotificationCenter open={showNotifs} entries={notifEntries} onClose={() => setShowNotifs(false)} />

      <InfoSheet
        open={showInfo}
        onClose={() => setShowInfo(false)}
        restaurantName={restaurantName}
        restaurantLogo={restaurantLogo}
        locationLabel={locationLabel}
        prepRange={prepRange}
        qrMode={qrMode}
        orderingAvailable={orderingAvailable}
        isRoom={isRoom}
        onCallWaiter={() => { setShowInfo(false); openCall(); }}
        onRequestBill={() => { setShowInfo(false); openBill(); }}
        billState={serviceNotif.request_bill}
        callState={serviceNotif.call_waiter}
      />

      {callDialog !== null && (
        <ActionDialog
          open
          title={isRoom ? "Call staff?" : "Call your waiter?"}
          message={callDialog === "success" ? (isRoom ? "Staff have been notified." : "Your waiter has been notified.") : `We'll let ${isRoom ? "the front desk" : "your waiter"} know you need assistance at ${locationLabel ?? "your seat"}.`}
          confirmLabel={isRoom ? "Call staff" : "Call waiter"}
          tone="var(--color-primary)"
          Icon={ConciergeBell}
          state={callDialog}
          onConfirm={() => runServiceRequest("call_waiter")}
          onClose={() => setCallDialog(null)}
        />
      )}

      {billDialog !== null && (
        <ActionDialog
          open
          title="Request your bill?"
          message={billDialog === "success" ? "Your bill request has been sent." : `We'll ask ${isRoom ? "the front desk" : "your waiter"} to bring the bill to ${locationLabel ?? "your seat"}.`}
          confirmLabel="Request bill"
          tone="#0d9488"
          Icon={Receipt}
          state={billDialog}
          onConfirm={() => runServiceRequest("request_bill")}
          onClose={() => setBillDialog(null)}
        />
      )}
    </div>
  );
}
