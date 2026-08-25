"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Printer, X } from "lucide-react";

// Shared, reusable receipt/ticket rendering used by both the live session screen
// (KOT + pre-payment bill) and the Sales dashboard (reprint of a PAID bill).

export type RestaurantInfo = {
  name: string;
  address: string | null;
  contact_phone: string | null;
  pan_vat_number: string | null;
  // Optional charges, applied to the bill only when > 0 (read from settings).
  tax_percent?: number;
  service_charge_percent?: number;
  // Printed at the top of a customer bill, when the restaurant has uploaded one.
  logo_url?: string | null;
  // Thermal roll width in mm; sizes the print page + on-screen preview. Default 80.
  paper_width_mm?: 58 | 80;
  // How the order's sequential number is shown (Admin → Settings). Used by the bill
  // AND the workstation tickets so every document on an order reads the same.
  bill_number_pad?: number;
  bill_number_label?: "bill" | "order";
};

export type BillItem = { id: string; item_name: string; item_price: number; quantity: number; is_custom?: boolean };

// Present only for a bill that has been closed — drives the PAID / ON CREDIT block.
export type BillPayment = {
  method: string; // display label, e.g. "Cash", "Cash + Online"
  cashier?: string | null;
  cash?: number; // split, for a mixed payment
  online?: number;
  card?: number;
};

// Present only for a bill closed with money still owed. A credit bill is billed
// in full — this is what's left of it.
export type BillCredit = {
  credit_number: string;
  customer_name: string;
  customer_phone?: string | null;
  /** Handed over at billing time. */
  tendered: number;
  /** Still owed right now (after any later repayments). */
  balance: number;
};

export const shortId = (id: string) => id.slice(0, 8).toUpperCase();

export function ticketNumber(prefix: string, seedId: string, at: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${prefix}-${shortId(seedId)}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
}

const rupee = (n: number) => `₹${n.toFixed(2)}`;

// ── print stylesheet (hides the app chrome, prints only the ticket) ────────────
// Thermal-first: the page IS the printable strip of the roll (see PRINTABLE_MM below —
// it is NOT the roll width). `@page { size: <W>mm <H>mm; margin: 0 }` tells the browser
// the paper is a W-mm-wide continuous roll with NO margins, so the receipt fills the
// head's full width instead of sitting as a sliver inside an A4 sheet — and the print
// preview then matches the physical output. On a plain A4 printer the same rules simply
// print a tidy W-mm column down the left edge, so A4 stays a valid fallback.

// The ticket's geometry lives here ONCE, because three places have to agree exactly or
// the printed page is the wrong height: the print stylesheet, the height measurement, and
// the on-screen preview. They used to disagree — the preview padded `14px 12px` while
// print padded `0 2mm` — so the measured page never quite matched what came out.
/**
 * Side margin inside the printable strip.
 *
 * This used to be a flat 1mm, which put the receipt hard against the left edge of the
 * paper: the head starts printing at dot 0, so "no page margin" means literally no
 * margin, and the first character of every left-aligned line sat on the edge with the
 * right-aligned column doing the same on the other side.
 *
 * The margin belongs HERE rather than in `@page`, because the page size has to keep
 * matching the driver's advertised paper exactly (see PRINTABLE_MM) — shrink the page
 * and Chrome stops honouring it, which is the right-hand-column clipping this whole
 * geometry was written to fix. So the page stays the full printable width and the
 * CONTENT is inset inside it.
 *
 * 58mm rolls get less, because 44mm of usable line is already tight for a bill.
 */
const SIDE_MARGIN_MM = { 58: 2, 80: 3 } as const;
const ticketPadding = (widthMm: 58 | 80) => `0 ${SIDE_MARGIN_MM[widthMm]}mm`;
const TICKET_LINE_HEIGHT = 1.45;
const fontPxFor = (widthMm: 58 | 80) => (widthMm === 58 ? 11 : 12);

/**
 * ── THE PAGE IS THE PRINT HEAD, NOT THE PAPER ────────────────────────────────
 *
 * A "80mm printer" takes an 80mm ROLL but its head only covers **72mm** (576 dots
 * at 203dpi, 8 dots/mm); the remaining ~4mm each side is physically unprintable.
 * 58mm rolls are the same story: **48mm** printable (384 dots).
 *
 * This used to lay the ticket out at the full roll width. Chrome only honours an
 * exact `@page` size when the driver offers a matching paper, and a thermal driver
 * advertises its paper as the PRINTABLE width (e.g. "80(72.1) x 297mm") — so an
 * 80mm-wide page was rendered into a 72mm one and the right-hand 8mm simply fell
 * off the sheet. On a real BOT that ate the right-aligned column: `BOT-0002…`,
 * `4 Aug 202…`, `Diwakar Gupt…`. Printing at 80-85% "fixed" it for the same reason
 * — 80mm × 0.85 ≈ 68mm finally fits inside 72mm.
 *
 * So author at the printable width and let the driver's own dead zone be dead.
 * Do NOT put the roll width back here.
 */
const PRINTABLE_MM = { 58: 48, 80: 72 } as const;
const printableMm = (rollMm: 58 | 80) => PRINTABLE_MM[rollMm];

/**
 * Blank paper fed after the last line, so the auto-cutter (or the tear bar) does not
 * come down through the footer. 4mm left the total sitting right on the cut; 10mm still
 * put the "powered by" footer on the edge of a hand-torn receipt.
 */
const TAIL_MM = 16;

function PrintStyles({ widthMm }: { widthMm: 58 | 80 }) {
  const fontPx = fontPxFor(widthMm);
  const printMm = printableMm(widthMm);
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
@media print {
  html, body { background:#fff !important; margin:0 !important; padding:0 !important; }
  /* The ticket is portaled to <body>, so it is a direct sibling of the app. Hiding every
     OTHER top-level node with display:none — NOT visibility:hidden — is what stops the
     bill printing as several identical pages: a visibility:hidden page still occupies its
     full height, and when that height spans multiple pages (e.g. a long Sales list you
     reprint a paid bill from) the browser paints a position:fixed ticket on EVERY one of
     them. display:none removes that height, so the ticket is the only thing left and it
     prints exactly once, in normal flow. */
  body > :not(.rs-print-portal) { display: none !important; }
  /* Unwrap the modal's on-screen chrome (backdrop, card, scroll box) so the ticket flows
     as the sole page content instead of sitting inside a fixed, scrolling, coloured box.
     the :not(style) is essential — this style tag is itself a child of .rs-print-portal, and
     forcing display:block on it would print its own CSS source text at the top of the page. */
  .rs-print-portal {
    position: static !important;
    display: block !important;
    overflow: visible !important;
    background: #fff !important;
  }
  .rs-print-portal > *:not(style) {
    position: static !important;
    display: block !important;
    overflow: visible !important;
    max-height: none !important;
    margin: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
    border: 0 !important;
  }
  .rs-print-portal > *:not(style) > * {
    max-height: none !important;
    overflow: visible !important;
    margin: 0 !important;
    padding: 0 !important;
    background: transparent !important;
  }
  .rs-print-portal style { display: none !important; }
  .rs-no-print { display: none !important; }
  .rs-ticket-print {
    position: static !important;
    width: ${printMm}mm !important;
    max-width: ${printMm}mm !important;
    margin: 0 auto !important;
    padding: ${ticketPadding(widthMm)} !important;
    box-shadow: none !important;
    background: #fff !important;
    font-size: ${fontPx}px !important;
    line-height: ${TICKET_LINE_HEIGHT} !important;
    overflow-wrap: anywhere;
  }
}
`,
      }}
    />
  );
}

// mm → CSS px at 96dpi, so the on-screen preview is the same width as the printed roll.
const MM_PER_PX = 25.4 / 96; // ≈ 0.2646
const mmToPx = (mm: number) => Math.round(mm / MM_PER_PX);
const pxToMm = (px: number) => px * MM_PER_PX;

// ── generic preview + print modal ──────────────────────────────────────────────

export function PrintModal({
  open,
  onClose,
  title,
  children,
  paperWidthMm = 80,
  onBeforePrint,
  printLabel = "Print",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Thermal roll width; sizes both the print page and the on-screen preview. */
  paperWidthMm?: 58 | 80;
  /**
   * Runs on Print, BEFORE the browser dialog opens; a non-ok result aborts it.
   *
   * Exists so an Order Ticket can be recorded server-side at the moment it is actually
   * printed — claiming its number and marking its items as sent — rather than when the
   * preview is merely opened. Callers update their own state inside this, and the
   * repainted ticket is what gets measured and printed. Bill/receipt callers omit it.
   *
   * The `error` is shown in the modal, so the reason a print was refused ("another till
   * already sent these") reaches the person holding the printer.
   */
  onBeforePrint?: () => Promise<{ ok: true } | { ok: false; error?: string }>;
  /** Overrides the Print button's text (e.g. "Print & send to Kitchen"). */
  printLabel?: string;
}) {
  // Portaled to <body>, and `document` only exists after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // The ticket, and a dedicated <style> that owns the @page size.
  const ticketRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLStyleElement | null>(null);

  // The @page rule lives in a <style> we create ourselves and put in <head> — NOT in a
  // React-rendered <style> inside the portal. `@page` is a document-level at-rule and
  // belongs in the document's stylesheet, and an element React does not own can never have
  // imperatively-set text reconciled away mid-print. It matters beyond tidiness: `margin: 0`
  // actually landing is the only lever we have on Chrome's print header/footer — with a zero
  // page margin Chrome defaults the dialog's Margins to "None" and omits them.
  useEffect(() => {
    const el = document.createElement("style");
    el.setAttribute("data-rs-page", "");
    document.head.appendChild(el);
    pageRef.current = el;
    return () => {
      el.remove();
      pageRef.current = null;
    };
  }, []);

  // A thermal roll has a fixed WIDTH but no fixed height — it prints continuously and
  // cuts at the end of the content. So the printed page must be `<width>mm × <content>mm`.
  // Chromium ignores `@page { size: <w> auto }` (it silently falls back to Letter, leaving
  // the receipt in the corner of a huge sheet), and only honours an EXPLICIT height. So we
  // measure the ticket's real rendered height at the roll width and set the page to match —
  // one continuous receipt, no wasted paper, preview == print.
  const measureAndSetPage = useCallback(() => {
    const el = ticketRef.current;
    const pageEl = pageRef.current;
    if (!el || !pageEl) return;
    const prevW = el.style.width;
    const prevP = el.style.padding;
    // Lay the ticket out at the exact print geometry, measure, then restore. The width
    // is the PRINT HEAD's, not the roll's — see printableMm.
    const printMm = printableMm(paperWidthMm);
    el.style.width = `${printMm}mm`;
    el.style.padding = ticketPadding(paperWidthMm);
    const heightPx = el.getBoundingClientRect().height;
    el.style.width = prevW;
    el.style.padding = prevP;
    // Tail of blank paper so the last line never clips and the cutter has a margin.
    const contentMm = Math.ceil(pxToMm(heightPx)) + TAIL_MM;
    // NEVER emit a page wider than it is tall. `@page { size: <w> <h> }` takes no
    // orientation keyword — the LARGER value decides — so 80mm × 63mm is not a short
    // portrait receipt, it is a LANDSCAPE one, and the browser rotates the content 90°.
    // That is exactly why short tickets printed sideways while longer bills came out
    // upright from this same line: a one-item KOT measures ~63mm on an 80mm roll, a bill
    // ~94mm. Nothing about the printer differed — only the content height.
    //
    // The cost is that a very short ticket feeds ~81mm of paper rather than ~63mm. There
    // is no way to ask for "portrait, shorter than wide", and `size: 80mm auto` is invalid
    // CSS which is dropped wholesale (that is the Letter fallback described above).
    const heightMm = Math.max(contentMm, printMm + 1);
    pageEl.textContent = `@page { size: ${printMm}mm ${heightMm}mm; margin: 0; }`;
  }, [paperWidthMm]);

  // Size the page whenever the preview opens (covers Ctrl+P as well as the Print button),
  // and BLANK it again on close. The blanking is not tidiness: a session screen mounts one
  // PrintModal per docket plus one for the bill, so several of these <style> elements sit
  // in <head> at once. If a closed modal kept its rule, two @page rules would be live and
  // the later one in document order would win — printing the bill at the KOT's page size.
  useEffect(() => {
    if (open && mounted) measureAndSetPage();
    else if (pageRef.current) pageRef.current.textContent = "";
    if (open) setErr(null);
  }, [open, mounted, measureAndSetPage]);

  if (!open || !mounted) return null;

  // The preview must be the PRINTED column, or it lies about what fits on a line.
  const previewPx = mmToPx(printableMm(paperWidthMm));

  const handlePrint = async () => {
    if (onBeforePrint) {
      setBusy(true);
      setErr(null);
      let res: { ok: true } | { ok: false; error?: string };
      try {
        res = await onBeforePrint();
      } catch {
        res = { ok: false };
      }
      setBusy(false);
      if (!res.ok) {
        setErr(res.error ?? "Could not prepare this ticket. Nothing was printed.");
        return;
      }
      // `onBeforePrint` changed what the ticket says (its number, its items). React has
      // to actually PAINT that before we measure, because the page height is measured
      // from live DOM — measuring first would size the page to the stale ticket. Two
      // frames is the reliable "after the next paint" barrier.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    measureAndSetPage(); // re-measure against the final laid-out content, then print
    window.print();
  };

  // Rendered at <body>, NOT inline. Two reasons, both learned the hard way:
  //  1. `position: fixed` here escapes the `.rs-page` entry-animation transform (and any
  //     pull-to-refresh transform), which would otherwise become its containing block and
  //     fling the modal off-screen — the same trap the credits modal hit.
  //  2. The outer div deliberately does NOT carry `rs-no-print`. It used to, and since the
  //     ticket lives INSIDE it, `display:none` on this ancestor removed the ticket from the
  //     print document entirely — the "print comes out blank" bug. The chrome (header/footer)
  //     is hidden via its own `rs-no-print`; the ticket is shown via the visibility rules.
  return createPortal(
    <div
      className="rs-print-portal fixed inset-0 z-[80] flex items-start sm:items-center justify-center overflow-y-auto"
      style={{ background: "rgba(13,37,61,0.45)" }}
      onClick={onClose}
    >
      <PrintStyles widthMm={paperWidthMm} />
      <div
        className="w-full max-w-sm my-6 rounded-2xl overflow-hidden"
        style={{ background: "var(--color-canvas)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b rs-no-print" style={{ borderColor: "var(--color-hairline)" }}>
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{title}</p>
          <button type="button" aria-label="Close" onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}>
            <X size={16} />
          </button>
        </div>

        {/* The ticket — the only thing that ends up on paper. */}
        <div className="px-4 py-4 max-h-[70vh] overflow-y-auto" style={{ background: "var(--color-canvas-soft)" }}>
          <div
            ref={ticketRef}
            className="rs-ticket-print mx-auto bg-white"
            // The preview keeps a comfortable padding for the modal; `measureAndSetPage`
            // swaps in the PRINT padding for the duration of the measurement, so this does
            // not skew the page height. Font size and line height must match print though —
            // those are NOT swapped, and a mismatch there would size the page wrongly.
            style={{ width: previewPx, padding: "14px 12px", color: "#000", fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace", fontSize: fontPxFor(paperWidthMm), lineHeight: TICKET_LINE_HEIGHT, overflowWrap: "anywhere" }}
          >
            {children}
          </div>
        </div>

        <div className="px-4 py-3 border-t rs-no-print" style={{ borderColor: "var(--color-hairline)" }}>
          {err && (
            <p className="text-xs mb-2 text-center" style={{ color: "var(--color-danger)" }}>{err}</p>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>Close</Button>
            <Button
              variant="primary"
              className="flex-1 flex items-center justify-center gap-2"
              onClick={handlePrint}
              disabled={busy}
            >
              <Printer size={14} /> {busy ? "Preparing…" : printLabel}
            </Button>
          </div>
          {/* The date, page number and web address that appear on paper are printed by the
              BROWSER, not by us — no stylesheet can remove them. They are two one-time
              checkboxes in the print dialog, so the instruction belongs next to the button
              the person holding the printer is about to press. */}
          <p className="text-[11px] mt-2 text-center leading-snug" style={{ color: "var(--color-ink-mute)" }}>
            First time on this device: in the print dialog set <strong>Margins: None</strong> and
            untick <strong>Headers and footers</strong> to remove the date, web address and page number.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── ticket primitives ──────────────────────────────────────────────────────────

export function Divider() {
  return <div style={{ borderTop: "1px dashed #000", margin: "8px 0" }} />;
}

export function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: bold ? 700 : 400 }}>
      <span>{label}</span>
      <span style={{ textAlign: "right" }}>{value}</span>
    </div>
  );
}

// Software credit at the very foot of a receipt, below the restaurant's own thank-you.
// Printed once per receipt (each receipt component renders it a single time).
//
// BLACK, not grey. A thermal head is ONE BIT — it can only burn a dot or not — so `#555`
// is not printed as lighter text, it is DITHERED into sparse dots, which on 203dpi paper
// came out as a smudge nobody could read. Grey is a screen idea; on a receipt the only
// way to be "quieter" than the rest is to be SMALLER, which is what the type sizes below
// do. Never reintroduce a grey here.
export function PoweredBy() {
  return (
    <div
      className="rs-powered-by"
      style={{ textAlign: "center", marginTop: 6, fontSize: 10, lineHeight: 1.3, color: "#000" }}
    >
      <div style={{ letterSpacing: 0.3, fontWeight: 700 }}>HRestroSewa</div>
      <div style={{ fontSize: 9 }}>Hotel &amp; Restaurant Management System</div>
    </div>
  );
}

// ── Bill (customer bill) — works both before payment (UNPAID) and as a reprint
//    of a completed transaction (PAID + method + cashier) ─────────────────────────

// Optional customer block for takeaway / delivery bills.
export type BillCustomer = {
  name: string | null;
  phone: string | null;
  address: string | null;
  /** 'citizenship' | 'nid' — a hotel guest's identity document. */
  idType?: string | null;
  idNumber?: string | null;
};

/** A room stay's own facts, printed above the lines. Absent on a table bill. */
export type BillStay = {
  roomType: string;
  rate: number;
  nights: number;
  checkIn: string;
  checkOut: string;
  duration: string;
};

/** Grouped lines — "Room charge", "Extras", "Food & beverages". */
export type BillSection = {
  title: string;
  lines: BillItem[];
};

export function BillTicket({
  restaurant,
  billNo,
  billLabel,
  location,
  at,
  items,
  sections,
  stay,
  payment,
  credit,
  customer,
  discount = 0,
  grandTotalOverride,
  advancePaid = 0,
  balanceDue,
  advanceCash = 0,
  advanceOnline = 0,
}: {
  restaurant: RestaurantInfo;
  billNo: string;
  /** Overrides the bill-number line label (e.g. "Bill No" / "Order No" from settings).
   *  When absent, falls back to "Receipt No" for a paid bill, "Bill No" otherwise. */
  billLabel?: string;
  location: string;
  at: Date;
  items: BillItem[];
  /** Grouped lines. When present these REPLACE `items` — a caller passes one or the
   *  other, never both. A room bill groups; a table bill has one flat list. */
  sections?: BillSection[];
  /** Hotel block. Present only for a room bill. */
  stay?: BillStay;
  payment?: BillPayment;
  credit?: BillCredit | null;
  customer?: BillCustomer | null;
  /** Knocked off at payment. Only a paid bill has one — the pre-payment preview is
   *  printed before the cashier has entered it, so it passes 0. */
  discount?: number;
  /**
   * Replaces the computed total on the TOTAL line. **Only the Mock Billing screen passes
   * this** — a real bill's total is derived from its own lines and must never be typed.
   *
   * Every real caller (the session preview, the Sales reprint, the room folio) omits it, so
   * this is `undefined` on every printed receipt in the business and their output is
   * unchanged. It exists so a demonstrator can show an arbitrary figure without having to
   * back-solve it out of prices and discounts.
   */
  grandTotalOverride?: number;
  /**
   * A deposit already received against this bill, and what is left to hand over.
   *
   * Printed ONLY when `advancePaid > 0` — which is never for a table bill, a walk-in or
   * the mock screen, so their output stays byte-identical. The GRAND TOTAL line does not
   * move either: the bill is still for the whole stay, and an advance is a payment
   * against it, not a reduction of it.
   */
  advancePaid?: number;
  balanceDue?: number;
  /**
   * How the deposit above was itself tendered. Printed as its own split line
   * whenever there's anything to show — unlike the checkout tender's split
   * (which stays silent for a single method, since the "Payment" line already
   * names it), the advance has no other line naming its method at all.
   */
  advanceCash?: number;
  advanceOnline?: number;
}) {
  const hasCustomer = !!(
    customer &&
    (customer.name || customer.phone || customer.address || customer.idNumber)
  );
  // Sections REPLACE items when supplied, so the subtotal is taken over whichever the
  // caller gave us — a room bill groups its lines, a table bill has one flat list.
  const allLines = sections ? sections.flatMap((s) => s.lines) : items;
  const subtotal = allLines.reduce((s, i) => s + Number(i.item_price) * i.quantity, 0);
  const taxPct = restaurant.tax_percent ?? 0;
  const svcPct = restaurant.service_charge_percent ?? 0;
  // The discount comes off BEFORE tax/service — you are not taxed on money you did not
  // pay. This is the rule lib/room-billing.ts buildFolio has always used; this component
  // used to take it off AFTER, so the same bill totalled differently depending on which
  // renderer you looked at (and a comment in room-billing.ts wrongly claimed they matched).
  // Every restaurant runs tax and service at 0 with tax-inclusive prices, so no printed
  // number moves today — this only decides what happens the day VAT is switched on.
  const taxable = Math.max(0, subtotal - discount);
  const tax = taxable * (taxPct / 100);
  const service = taxable * (svcPct / 100);
  // The override (mock bills only) replaces the figure on the TOTAL line and nothing else —
  // subtotal, tax, service and discount all still print their own derived values.
  const grandTotal = grandTotalOverride ?? taxable + tax + service;

  // Show the tender split whenever the bill was settled with more than one.
  const parts = payment
    ? [
        { label: "Cash", v: payment.cash ?? 0 },
        { label: "Online", v: payment.online ?? 0 },
        { label: "Card", v: payment.card ?? 0 },
      ].filter((p) => p.v > 0)
    : [];
  const tenderSplit =
    parts.length > 1 ? parts.map((p) => `${p.label} ${rupee(p.v)}`).join(" · ") : null;

  // Unlike the checkout tender above, nothing else on this receipt names how the
  // advance arrived — so this prints even for a single method, not just a mix.
  const advanceParts = [
    { label: "Cash", v: advanceCash },
    { label: "Online", v: advanceOnline },
  ].filter((p) => p.v > 0);
  const advanceSplit =
    advanceParts.length > 0 ? advanceParts.map((p) => `${p.label} ${rupee(p.v)}`).join(" · ") : null;

  return (
    <>
      {/* No logo: a thermal head prints one-bit black on grey paper, so a colour or
          photographic logo reproduces as a smear — and it cost up to 48px (~13mm) of every
          roll. The restaurant's NAME is the branding on paper. */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{restaurant.name}</div>
        {restaurant.address && <div style={{ fontSize: 11 }}>{restaurant.address}</div>}
        {restaurant.pan_vat_number && <div style={{ fontSize: 11 }}>PAN No.: {restaurant.pan_vat_number}</div>}
        {restaurant.contact_phone && <div style={{ fontSize: 11 }}>Ph: {restaurant.contact_phone}</div>}
        {/* ALWAYS "BILL" — never "TAX INVOICE" after payment. The document does not
            change when it is paid, so its title must not either: the same sale showing
            two different titles is what made a paid bill look like a different
            document from the one the customer was handed. */}
        <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: 2, marginTop: 4 }}>BILL</div>
      </div>
      <Divider />
      {/* The table/room is what staff match the bill to — make it prominent. */}
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: 18, marginBottom: 4 }}>{location}</div>
      {/* "Bill No" whether paid or not, for the same reason the title is always BILL —
          it is one document with one number. (An admin who prefers "Order No" sets it in
          Settings; that override still wins, and still applies to both states.) */}
      <Line label={billLabel ?? "Bill No"} value={billNo} />
      <Line label="Date" value={at.toLocaleDateString("en-IN", { dateStyle: "medium" })} />
      <Line label="Time" value={at.toLocaleTimeString("en-IN", { timeStyle: "short" })} />
      {/* The hotel block. A room bill has to answer "which room type, for how many nights,
          at what rate, between when and when" — a table bill has none of that. */}
      {stay && (
        <>
          <Line label="Room type" value={stay.roomType} />
          <Line
            label="Check-in"
            value={new Date(stay.checkIn).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
          />
          <Line
            label="Check-out"
            value={new Date(stay.checkOut).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
          />
          <Line label="Nights" value={`${stay.nights} × ${rupee(stay.rate)}`} />
        </>
      )}
      {payment?.cashier && <Line label="Cashier" value={payment.cashier} />}
      {credit && <Line label="Credit ID" value={credit.credit_number} />}
      {/* "Credit a/c", not "Customer": on a room bill the guest is printed below as well,
          and the two are not always the same person — a company account can settle for a
          guest. Two lines both labelled "Customer" said nothing about which was which. */}
      {credit && <Line label="Credit a/c" value={credit.customer_name} />}
      {hasCustomer && (
        <>
          {customer!.name && <Line label="Customer" value={customer!.name} />}
          {customer!.phone && <Line label="Phone" value={customer!.phone} />}
          {customer!.idNumber && (
            <Line
              label={customer!.idType === "nid" ? "NID No" : "Citizenship No"}
              value={customer!.idNumber}
            />
          )}
          {customer!.address && (
            <div style={{ fontSize: 11, marginTop: 2 }}>{customer!.address}</div>
          )}
        </>
      )}
      <Divider />

      {/* Items */}
      <div style={{ display: "flex", fontWeight: 700, fontSize: 11 }}>
        <span style={{ flex: 1 }}>Item</span>
        <span style={{ width: 28, textAlign: "center" }}>Qty</span>
        <span style={{ width: 54, textAlign: "right" }}>Rate</span>
        <span style={{ width: 62, textAlign: "right" }}>Amount</span>
      </div>
      <div style={{ borderTop: "1px solid #000", margin: "4px 0" }} />
      {sections ? (
        // Grouped: a heading, then that group's lines. Same row markup as the flat list
        // below, so a room bill and a table bill line up column for column on paper.
        sections.map((sec) => (
          <div key={sec.title}>
            <div style={{ fontWeight: 700, fontSize: 11, marginTop: 4 }}>{sec.title}</div>
            {sec.lines.map((it) => (
              <div key={it.id} style={{ display: "flex", alignItems: "flex-start", marginTop: 2 }}>
                <span style={{ flex: 1, overflowWrap: "anywhere" }}>{it.item_name}</span>
                <span style={{ width: 28, textAlign: "center" }}>{it.quantity}</span>
                <span style={{ width: 54, textAlign: "right" }}>{Number(it.item_price).toFixed(2)}</span>
                <span style={{ width: 62, textAlign: "right" }}>
                  {(Number(it.item_price) * it.quantity).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        ))
      ) : items.length === 0 ? (
        <div style={{ textAlign: "center" }}>No items.</div>
      ) : (
        items.map((it) => (
          <div key={it.id} style={{ display: "flex", alignItems: "flex-start", marginTop: 2 }}>
            <span style={{ flex: 1, overflowWrap: "anywhere" }}>
              {it.item_name}
              {it.is_custom && <span style={{ fontSize: 9, marginLeft: 3 }}>*</span>}
            </span>
            <span style={{ width: 28, textAlign: "center" }}>{it.quantity}</span>
            <span style={{ width: 54, textAlign: "right" }}>{Number(it.item_price).toFixed(2)}</span>
            <span style={{ width: 62, textAlign: "right" }}>{(Number(it.item_price) * it.quantity).toFixed(2)}</span>
          </div>
        ))
      )}
      {items.some((i) => i.is_custom) && (
        <div style={{ fontSize: 10, marginTop: 3 }}>* custom item</div>
      )}
      <Divider />

      <Line label="Subtotal" value={rupee(subtotal)} />
      {tax > 0 && <Line label={`Tax (${taxPct}%)`} value={rupee(tax)} />}
      {service > 0 && <Line label={`Service (${svcPct}%)`} value={rupee(service)} />}
      {discount > 0 && <Line label="Discount" value={`- ${rupee(discount)}`} />}
      <div style={{ borderTop: "1px solid #000", margin: "6px 0" }} />
      <Line label={discount > 0 ? "TOTAL PAYABLE" : "GRAND TOTAL"} value={rupee(grandTotal)} bold />
      {advancePaid > 0 && (
        <>
          <Line label="Advance received" value={`- ${rupee(advancePaid)}`} />
          {advanceSplit && <div style={{ fontSize: 11, textAlign: "right" }}>{advanceSplit}</div>}
          <div style={{ borderTop: "1px solid #000", margin: "6px 0" }} />
          <Line
            label="BALANCE PAYABLE"
            value={rupee(balanceDue ?? Math.max(0, grandTotal - advancePaid))}
            bold
          />
        </>
      )}
      <Divider />

      {credit ? (
        // Closed with money still owed — the receipt has to say so, and say how
        // much, or it reads as a paid bill.
        <>
          <Line
            label="Status"
            value={credit.tendered > 0 ? "PARTIALLY PAID" : "ON CREDIT"}
            bold
          />
          {credit.tendered > 0 && <Line label="Paid at billing" value={rupee(credit.tendered)} />}
          {tenderSplit && <div style={{ fontSize: 11, textAlign: "right" }}>{tenderSplit}</div>}
          <div style={{ borderTop: "1px solid #000", margin: "6px 0" }} />
          <Line label="BALANCE DUE" value={rupee(credit.balance)} bold />
          {credit.customer_phone && (
            <div style={{ fontSize: 11, marginTop: 4 }}>Ph: {credit.customer_phone}</div>
          )}
          <div style={{ textAlign: "center", fontSize: 11, marginTop: 6 }}>
            Please retain this receipt until the balance is settled.
          </div>
        </>
      ) : payment ? (
        <>
          <Line label="Status" value="PAID" bold />
          <Line label="Payment" value={payment.method} />
          {tenderSplit && <div style={{ fontSize: 11, textAlign: "right" }}>{tenderSplit}</div>}
        </>
      ) : (
        <div style={{ textAlign: "center", fontSize: 11 }}>Status: UNPAID</div>
      )}
      {!credit && (
        <div style={{ textAlign: "center", fontSize: 11, marginTop: 6 }}>Thank you! Please visit again.</div>
      )}
      {/* Rule + credit as one footer block, so the software name reads as a "powered by"
          sign-off under the restaurant's own thank-you rather than competing with it. */}
      <Divider />
      <PoweredBy />
    </>
  );
}

// ── Credit receipt — the record of a customer's debt and everything paid against
//    it. Reprintable at any time; reflects the balance as of NOW. ──────────────

export type CreditReceiptEntry = {
  id: string;
  amount: number;
  method: string;
  staff_name: string | null;
  created_at: string;
  at_billing: boolean;
};

export function CreditReceiptTicket({
  restaurant,
  creditNumber,
  customerName,
  customerPhone,
  openedAt,
  location,
  billAmount,
  paidAmount,
  balance,
  history,
  notes,
}: {
  restaurant: RestaurantInfo;
  creditNumber: string;
  customerName: string;
  customerPhone: string | null;
  openedAt: Date;
  location: string;
  billAmount: number;
  paidAmount: number;
  balance: number;
  history: CreditReceiptEntry[];
  notes: string | null;
}) {
  const settled = balance <= 0;

  return (
    <>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{restaurant.name}</div>
        {restaurant.address && <div style={{ fontSize: 11 }}>{restaurant.address}</div>}
        {/* Same order as the bill: PAN, then phone. */}
        {restaurant.pan_vat_number && <div style={{ fontSize: 11 }}>PAN/VAT: {restaurant.pan_vat_number}</div>}
        {restaurant.contact_phone && <div style={{ fontSize: 11 }}>Ph: {restaurant.contact_phone}</div>}
        <div style={{ fontWeight: 700, letterSpacing: 1, marginTop: 4 }}>
          {settled ? "CREDIT RECEIPT — SETTLED" : "CREDIT RECEIPT"}
        </div>
      </div>
      <Divider />
      <Line label="Credit ID" value={creditNumber} />
      <Line label="Customer" value={customerName} />
      {customerPhone && <Line label="Phone" value={customerPhone} />}
      <Line label="Table" value={location} />
      <Line label="Opened" value={openedAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} />
      <Divider />

      <Line label="Original bill" value={rupee(billAmount)} />
      <Line label="Total paid" value={rupee(paidAmount)} />
      <div style={{ borderTop: "1px solid #000", margin: "6px 0" }} />
      <Line label={settled ? "BALANCE" : "BALANCE DUE"} value={rupee(balance)} bold />
      <Divider />

      <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 4 }}>Payment history</div>
      {history.length === 0 ? (
        <div style={{ textAlign: "center", fontSize: 11 }}>No payments received yet.</div>
      ) : (
        history.map((h) => (
          <div key={h.id} style={{ marginTop: 3 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>
                {new Date(h.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                {" · "}
                {h.method}
                {h.at_billing ? " (at billing)" : ""}
              </span>
              <span>{rupee(h.amount)}</span>
            </div>
            {/* Black for the same reason as PoweredBy: grey dithers to an unreadable
                smudge on a 1-bit thermal head. Smaller type is the only "quieter". */}
            {h.staff_name && (
              <div style={{ fontSize: 10 }}>Received by {h.staff_name}</div>
            )}
          </div>
        ))
      )}

      {notes && (
        <>
          <Divider />
          <div style={{ fontSize: 11 }}>Note: {notes}</div>
        </>
      )}

      <Divider />
      <div style={{ textAlign: "center", fontSize: 11 }}>
        {settled
          ? "This credit is fully settled. Thank you!"
          : "Please retain this receipt until the balance is settled."}
      </div>
      <Divider />
      <PoweredBy />
    </>
  );
}
