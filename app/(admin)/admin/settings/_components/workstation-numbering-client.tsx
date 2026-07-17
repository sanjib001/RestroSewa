"use client";

import { useActionState, useState } from "react";
import { updateWorkstationNumbering, type ActionResult, type WorkstationNumbering } from "@/app/actions/settings";
import { formatOtNumber } from "@/lib/billing/ot-number";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Printer, CheckCircle2 } from "lucide-react";

// Live preview + inputs for ONE workstation's OT numbering. Each workstation is independent.
function WorkstationRow({ ws }: { ws: WorkstationNumbering }) {
  const [prefix, setPrefix] = useState(ws.prefix);
  const [next, setNext] = useState(ws.next === null ? "" : String(ws.next));

  const nextNum = next.trim() === "" ? null : Number(next);
  const effectivePrefix = (prefix.trim() || ws.defaultPrefix).toUpperCase();
  const preview =
    nextNum !== null && Number.isInteger(nextNum) && nextNum >= 0
      ? formatOtNumber(effectivePrefix, nextNum)
      : null;

  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
    >
      <p className="text-sm font-medium mb-2" style={{ color: "var(--color-ink)" }}>{ws.name}</p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>OT prefix</span>
          <Input
            name={`prefix_${ws.id}`}
            value={prefix}
            onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            placeholder={ws.defaultPrefix}
            maxLength={6}
            className="w-28 uppercase"
            style={{ textTransform: "uppercase" }}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Next number</span>
          <Input
            name={`next_${ws.id}`}
            value={next}
            onChange={(e) => setNext(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            placeholder="off"
            className="w-28"
          />
        </label>
        <div className="text-xs font-mono pb-2.5" style={{ color: "var(--color-ink-mute)" }}>
          {preview ? (
            <>Prints: <strong style={{ color: "var(--color-ink)" }}>{effectivePrefix} No.: {preview}</strong></>
          ) : (
            <>Numbering off (uses a derived ref)</>
          )}
        </div>
      </div>
    </div>
  );
}

export function WorkstationNumberingClient({ workstations }: { workstations: WorkstationNumbering[] }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(updateWorkstationNumbering, null);
  const saved = state !== null && "ok" in state;
  const errored = state !== null && "error" in state;

  return (
    <form action={action} className="max-w-2xl">
      <section
        className="rounded-xl border px-5 py-5"
        style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
      >
        <p className="text-sm font-medium mb-1 flex items-center gap-2" style={{ color: "var(--color-ink)" }}>
          <Printer size={15} /> Workstation ticket numbering
        </p>
        <p className="text-xs mb-4" style={{ color: "var(--color-ink-mute)" }}>
          Give each workstation its own running Order-Ticket number (KOT-00125, BOT-00086 …). Set the
          next number to start counting; leave blank to turn it off. Each sequence is independent, and
          changing one only affects that workstation&apos;s future tickets.
        </p>

        {workstations.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            No workstations yet. Add them under Workstations, and they&apos;ll appear here automatically.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {workstations.map((w) => (
              <WorkstationRow key={w.id} ws={w} />
            ))}
          </div>
        )}

        {workstations.length > 0 && (
          <div className="flex items-center gap-3 mt-4">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            {saved && (
              <span className="text-sm flex items-center gap-1.5" style={{ color: "var(--color-success)" }}>
                <CheckCircle2 size={15} /> Saved
              </span>
            )}
            {errored && (
              <span className="text-sm" style={{ color: "var(--color-ruby)" }}>{(state as { error: string }).error}</span>
            )}
          </div>
        )}
      </section>
    </form>
  );
}
