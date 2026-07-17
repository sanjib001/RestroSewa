"use client";

import { useActionState, useTransition, useState, useEffect, useRef } from "react";
import {
  createTableGroup,
  createTable,
  updateTable,
  toggleTableStatus,
  deleteTable,
  deleteTableGroup,
  regenerateTableQr,
  setTableGroupWaiters,
} from "@/app/actions/tables-admin";
import type { ActionResult, GroupWithTables, TableRow } from "@/app/actions/tables-admin";
import type { EmployeeOption } from "../page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QrCode, Trash2, X, Download, Pencil, RefreshCw, UserRound } from "lucide-react";
import dynamic from "next/dynamic";

// The QR canvas only ever renders INSIDE the print dialog — a modal most admins open
// rarely and many never open at all. Loading its library on the initial page render
// makes every visit to the table list pay for a feature it is not using. Fetched on
// demand instead, at the moment the dialog opens.
const QRCodeCanvas = dynamic(
  () => import("qrcode.react").then((m) => m.QRCodeCanvas),
  { ssr: false, loading: () => <div style={{ width: 220, height: 220 }} /> }
);

// ─── QR Modal ─────────────────────────────────────────────────────────────────

type QrTarget = { table: TableRow; url: string } | null;

function QrModal({
  target,
  onClose,
  onRegenerate,
}: {
  target: QrTarget;
  onClose: () => void;
  onRegenerate: (tableId: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (target) document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [target, onClose]);

  if (!target) return null;

  function download() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `table-${target!.table.number}-qr.png`;
    link.click();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="flex flex-col items-center gap-5 rounded-2xl p-6 w-full max-w-xs"
        style={{ background: "var(--color-canvas)", boxShadow: "0 16px 48px rgba(0,0,0,0.18)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between w-full">
          <p className="font-medium text-base" style={{ color: "var(--color-ink)" }}>
            Table {target.table.number}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
          >
            <X size={14} />
          </button>
        </div>

        <div
          className="p-3 rounded-xl"
          // MUST stay white in both themes — a QR needs a light quiet zone to scan. Do NOT
          // tokenise this to --color-canvas; a dark background makes the code unscannable.
          style={{ background: "#ffffff", border: "1px solid var(--color-hairline)" }}
        >
          <QRCodeCanvas
            ref={canvasRef}
            value={target.url}
            size={220}
            level="M"
            marginSize={2}
          />
        </div>

        <p
          className="text-xs text-center break-all leading-relaxed max-w-[240px]"
          style={{ color: "var(--color-ink-mute)" }}
        >
          {target.url}
        </p>

        <div className="flex gap-2 w-full">
          <Button
            type="button"
            variant="primary"
            className="flex-1 flex items-center justify-center gap-1.5"
            onClick={download}
          >
            <Download size={13} />
            Download PNG
          </Button>
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            Close
          </Button>
        </div>
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs"
          style={{ color: "var(--color-ink-mute)" }}
          onClick={() => {
            if (confirm("Regenerate QR code? All printed QR codes for this table will stop working.")) {
              onRegenerate(target!.table.id);
              onClose();
            }
          }}
        >
          <RefreshCw size={11} />
          Regenerate QR code
        </button>
      </div>
    </div>
  );
}

// ─── Table Pill ───────────────────────────────────────────────────────────────

function TablePill({
  table,
  groups,
  onQrClick,
}: {
  table: TableRow;
  groups: GroupWithTables[];
  onQrClick: (table: TableRow) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [, startToggle] = useTransition();
  const [, startDelete] = useTransition();
  const [editState, editAction, editPending] = useActionState<ActionResult, FormData>(
    updateTable,
    null
  );
  const [editSubmitted, setEditSubmitted] = useState(false);

  useEffect(() => { if (editPending) setEditSubmitted(true); }, [editPending]);
  useEffect(() => {
    if (editSubmitted && !editPending && editState === null) {
      setEditSubmitted(false);
      setEditing(false);
    }
  }, [editSubmitted, editPending, editState]);

  if (editing) {
    return (
      <form
        action={editAction}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm flex-wrap"
        style={{
          borderColor: "var(--color-primary)",
          borderWidth: 1.5,
          background: "var(--color-canvas)",
        }}
      >
        <input type="hidden" name="id" value={table.id} />
        <Input
          name="number"
          defaultValue={table.number}
          required
          className="w-16 h-7 text-xs px-2"
          placeholder="No."
        />
        {/* Every table must belong to a group — assignment is group-based */}
        <select
          name="group_id"
          defaultValue={table.group_id ?? ""}
          required
          className="h-7 rounded border px-1.5 text-xs"
          style={{
            borderColor: "var(--color-hairline-input)",
            color: "var(--color-ink)",
            background: "var(--color-canvas)",
          }}
        >
          <option value="" disabled>Group…</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={editPending}
          className="text-xs px-2 py-1 rounded font-medium"
          style={{ background: "var(--color-primary)", color: "#fff" }}
        >
          {editPending ? "…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          style={{ color: "var(--color-ink-mute)" }}
        >
          <X size={12} />
        </button>
        {editState?.error && (
          <p className="text-xs w-full" style={{ color: "var(--color-ruby)" }}>
            {editState.error}
          </p>
        )}
      </form>
    );
  }

  return (
    <div
      className="flex flex-col rounded-lg border text-sm"
      style={{
        background: "var(--color-canvas)",
        borderColor: "var(--color-hairline)",
        opacity: table.is_active ? 1 : 0.5,
      }}
    >
      {/* Main row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span style={{ color: "var(--color-ink)", fontWeight: 400 }}>T{table.number}</span>
        <button type="button" title="Show QR code" style={{ color: "var(--color-ink-mute)" }} onClick={() => onQrClick(table)}>
          <QrCode size={13} />
        </button>
        <button type="button" title="Edit table" style={{ color: "var(--color-ink-mute)" }} onClick={() => setEditing(true)}>
          <Pencil size={12} />
        </button>
        <button
          type="button"
          className="text-xs"
          style={{ color: table.is_active ? "var(--color-success)" : "var(--color-ink-mute)" }}
          onClick={() => startToggle(async () => { await toggleTableStatus(table.id, !table.is_active); })}
        >
          {table.is_active ? "●" : "○"}
        </button>
        <button
          type="button"
          style={{ color: "var(--color-ink-mute)" }}
          onClick={() => startDelete(async () => {
            if (confirm(`Delete table ${table.number}?`)) {
              const r = await deleteTable(table.id);
              if (r?.error) alert(r.error);
            }
          })}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// ─── Delete Group Button ──────────────────────────────────────────────────────

function DeleteGroupButton({
  groupId,
  groupName,
  tableCount,
  staffCount,
}: {
  groupId: string;
  groupName: string;
  tableCount: number;
  staffCount: number;
}) {
  const [pending, startDelete] = useTransition();

  // Surface the blocking reasons before hitting the server so the admin knows
  // what to fix. The server re-validates and is the source of truth.
  const blockers: string[] = [];
  if (tableCount > 0) blockers.push(`${tableCount} table${tableCount === 1 ? "" : "s"}`);
  if (staffCount > 0) blockers.push(`${staffCount} staff member${staffCount === 1 ? "" : "s"}`);

  function handleClick() {
    if (blockers.length > 0) {
      alert(
        `"${groupName}" can't be deleted yet — it still has ${blockers.join(" and ")} assigned to it.\n\n` +
          `Reassign or remove them first, then try again.`
      );
      return;
    }
    if (!confirm(`Delete the table group "${groupName}"? This cannot be undone.`)) return;
    startDelete(async () => {
      const r = await deleteTableGroup(groupId);
      if (r?.error) alert(r.error);
    });
  }

  return (
    <button
      type="button"
      title="Delete table group"
      onClick={handleClick}
      disabled={pending}
      className="inline-flex items-center gap-1 text-xs"
      style={{ color: blockers.length > 0 ? "var(--color-ink-mute)" : "#dc2626", opacity: pending ? 0.5 : 1 }}
    >
      <Trash2 size={12} />
      {pending ? "Deleting…" : "Delete group"}
    </button>
  );
}

// ─── Group Waiter Bar ─────────────────────────────────────────────────────────

function TableGroupWaiterBar({
  groupId,
  employees,
  assignedUserIds,
}: {
  groupId: string;
  employees: EmployeeOption[];
  assignedUserIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [localAssigned, setLocalAssigned] = useState<string[]>(assignedUserIds);
  const [, startAssign] = useTransition();

  const assignedKey = [...assignedUserIds].sort().join(",");
  useEffect(() => {
    setLocalAssigned(assignedUserIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedKey]);

  if (employees.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button
        type="button"
        title="Assign staff to this group — they will receive this group's orders and calls"
        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
        style={{
          color: localAssigned.length > 0 ? "var(--color-primary)" : "var(--color-ink-mute)",
          borderColor: localAssigned.length > 0 ? "var(--color-primary)" : "var(--color-hairline)",
          background: localAssigned.length > 0 ? "rgba(99,102,241,0.08)" : "transparent",
        }}
        onClick={() => setOpen((o) => !o)}
      >
        <UserRound size={12} />
        {localAssigned.length > 0 ? `${localAssigned.length} staff` : "Assign staff"}
      </button>
      {open && (
        <div className="flex flex-wrap gap-1">
          {employees.map((e) => {
            const active = localAssigned.includes(e.id);
            return (
              <button
                key={e.id}
                type="button"
                className="text-xs px-2 py-0.5 rounded-full border"
                style={{
                  background: active ? "rgba(99,102,241,0.08)" : "transparent",
                  borderColor: active ? "var(--color-primary)" : "var(--color-hairline)",
                  color: active ? "var(--color-primary)" : "var(--color-ink-mute)",
                }}
                onClick={() =>
                  startAssign(async () => {
                    const next = active
                      ? localAssigned.filter((id) => id !== e.id)
                      : [...localAssigned, e.id];
                    setLocalAssigned(next);
                    await setTableGroupWaiters(groupId, next);
                  })
                }
              >
                {e.display_name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Forms ────────────────────────────────────────────────────────────────────

function AddTableForm({
  restaurantId,
  groups,
  defaultGroupId,
}: {
  restaurantId: string;
  groups: GroupWithTables[];
  defaultGroupId?: string;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(createTable, null);

  // Tables must belong to a group. If none exist yet, prompt the admin to make one.
  if (groups.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
        Create a table group below before adding tables.
      </p>
    );
  }

  return (
    <form action={action} className="flex items-end gap-2 flex-wrap">
      <input type="hidden" name="restaurant_id" value={restaurantId} />
      <div className="flex flex-col gap-1">
        <label className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          Table number/name
        </label>
        <Input name="number" placeholder="1, A1, Bar-1…" className="w-36" required />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          Group
        </label>
        <select
          name="group_id"
          defaultValue={defaultGroupId ?? ""}
          required
          className="h-9 rounded-sm border px-3 text-sm"
          style={{ borderColor: "var(--color-hairline-input)", color: "var(--color-ink)", background: "var(--color-canvas)" }}
        >
          <option value="" disabled>Select group…</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Adding…" : "Add table"}
      </Button>
      {state?.error && (
        <p className="text-xs self-end" style={{ color: "var(--color-ruby)" }}>{state.error}</p>
      )}
    </form>
  );
}

function AddGroupForm({ restaurantId }: { restaurantId: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(createTableGroup, null);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="restaurant_id" value={restaurantId} />
      <Input name="name" placeholder="Group name (e.g. Indoor, Rooftop…)" className="flex-1" required />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Adding…" : "Add group"}
      </Button>
      {state?.error && (
        <p className="text-xs" style={{ color: "var(--color-ruby)" }}>{state.error}</p>
      )}
    </form>
  );
}

// ─── Main Client ──────────────────────────────────────────────────────────────

export function TablesClient({
  ungrouped,
  groups,
  restaurantId,
  restaurantSlug,
  employees,
  assignedByTableGroup,
}: {
  ungrouped: TableRow[];
  groups: GroupWithTables[];
  restaurantId: string;
  restaurantSlug: string;
  employees: EmployeeOption[];
  assignedByTableGroup: Record<string, string[]>;
}) {
  const [qrTarget, setQrTarget] = useState<QrTarget>(null);
  const [, startRegen] = useTransition();
  const totalTables = ungrouped.length + groups.reduce((n, g) => n + g.tables.length, 0);

  function handleQrClick(table: TableRow) {
    const url = restaurantSlug
      ? `${window.location.origin}/c/${restaurantSlug}?table=${table.qr_token}`
      : `${window.location.origin}/c?table=${table.qr_token}`;
    setQrTarget({ table, url });
  }

  function handleRegenerate(tableId: string) {
    startRegen(async () => {
      const r = await regenerateTableQr(tableId);
      if (r?.error) alert(r.error);
    });
  }

  return (
    <>
      <QrModal target={qrTarget} onClose={() => setQrTarget(null)} onRegenerate={handleRegenerate} />

      <div className="flex flex-col gap-8 max-w-2xl">
        <p className="text-sm -mt-4" style={{ color: "var(--color-ink-mute)" }}>
          {totalTables} tables total
        </p>

        {/* Groups */}
        {groups.map((g) => (
          <div key={g.id}>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <p
                className="text-xs uppercase tracking-wide font-medium"
                style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
              >
                {g.name}
              </p>
              <TableGroupWaiterBar
                groupId={g.id}
                employees={employees}
                assignedUserIds={assignedByTableGroup[g.id] ?? []}
              />
              <span className="ml-auto">
                <DeleteGroupButton
                  groupId={g.id}
                  groupName={g.name}
                  tableCount={g.tables.length}
                  staffCount={(assignedByTableGroup[g.id] ?? []).length}
                />
              </span>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {g.tables.map((t) => (
                <TablePill key={t.id} table={t} groups={groups} onQrClick={handleQrClick} />
              ))}
              {g.tables.length === 0 && (
                <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>No tables in this group.</p>
              )}
            </div>
            <AddTableForm restaurantId={restaurantId} groups={groups} defaultGroupId={g.id} />
          </div>
        ))}

        {/* Ungrouped — legacy tables without a group. Edit them to assign a group;
            until then only admins/managers can see their orders. */}
        {ungrouped.length > 0 && (
          <div>
            <p
              className="text-xs uppercase tracking-wide mb-1 font-medium"
              style={{ color: "var(--color-warning)", letterSpacing: "0.06em" }}
            >
              Ungrouped — needs a group
            </p>
            <p className="text-xs mb-3" style={{ color: "var(--color-ink-mute)" }}>
              These tables aren&apos;t in a group, so staff can&apos;t receive their orders. Edit each to assign a group.
            </p>
            <div className="flex flex-wrap gap-2 mb-3">
              {ungrouped.map((t) => (
                <TablePill key={t.id} table={t} groups={groups} onQrClick={handleQrClick} />
              ))}
            </div>
          </div>
        )}

        {groups.length === 0 && ungrouped.length === 0 && (
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            No tables yet. Create a table group first, then add tables to it.
          </p>
        )}

        {/* Add table to ungrouped (when groups exist) */}
        {groups.length > 0 && (
          <div>
            <p
              className="text-xs uppercase tracking-wide mb-3 font-medium"
              style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
            >
              Add table
            </p>
            <AddTableForm restaurantId={restaurantId} groups={groups} />
          </div>
        )}

        {/* Add group */}
        <div
          className="rounded-xl border px-5 py-4"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
        >
          <p className="text-sm font-medium mb-3" style={{ color: "var(--color-ink)" }}>
            Add table group
          </p>
          <AddGroupForm restaurantId={restaurantId} />
        </div>
      </div>
    </>
  );
}
