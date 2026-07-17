"use client";

import { useActionState, useTransition, useState, useEffect, useRef } from "react";
import {
  createRoomType,
  updateRoomType,
  deleteRoomType,
  createRoom,
  updateRoom,
  setRoomStatus,
  deleteRoom,
  regenerateRoomQr,
  setRoomWaiters,
  setRoomTypeWaiters,
} from "@/app/actions/rooms-admin";
import type { ActionResult, RoomRow, RoomTypeWithRooms } from "@/app/actions/rooms-admin";
import { STATUS_STYLE } from "@/lib/status-colors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QrCode, Trash2, X, Download, Pencil, RefreshCw, UserRound } from "lucide-react";

export type EmployeeOption = { id: string; display_name: string };
import dynamic from "next/dynamic";

// The QR canvas only ever renders INSIDE the print dialog — a modal most admins open
// rarely and many never open at all. Loading its library on the initial page render
// makes every visit to the table list pay for a feature it is not using. Fetched on
// demand instead, at the moment the dialog opens.
const QRCodeCanvas = dynamic(
  () => import("qrcode.react").then((m) => m.QRCodeCanvas),
  { ssr: false, loading: () => <div style={{ width: 220, height: 220 }} /> }
);

// ─── Status helpers ───────────────────────────────────────────────────────────

type RoomStatus = RoomRow["status"];

// One shared palette across the staff grids and here — this page used to paint Maintenance
// red while the staff rooms grid painted it grey, for the same status. See lib/status-colors.
const STATUS_LABEL: Record<RoomStatus, string> = {
  available:   STATUS_STYLE.available.label,
  occupied:    STATUS_STYLE.occupied.label,
  cleaning:    STATUS_STYLE.cleaning.label,
  maintenance: STATUS_STYLE.maintenance.label,
};
const STATUS_COLOR: Record<RoomStatus, string> = {
  available:   STATUS_STYLE.available.color,
  occupied:    STATUS_STYLE.occupied.color,
  cleaning:    STATUS_STYLE.cleaning.color,
  maintenance: STATUS_STYLE.maintenance.color,
};

// ─── QR Modal ─────────────────────────────────────────────────────────────────

type QrTarget = { room: RoomRow; url: string } | null;

function QrModal({
  target,
  onClose,
  onRegenerate,
}: {
  target: QrTarget;
  onClose: () => void;
  onRegenerate: (roomId: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    if (target) document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [target, onClose]);

  if (!target) return null;

  function download() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `room-${target!.room.number}-qr.png`;
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
            Room {target.room.number}
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
          <QRCodeCanvas ref={canvasRef} value={target.url} size={220} level="M" marginSize={2} />
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
            if (confirm("Regenerate QR code? All printed QR codes for this room will stop working.")) {
              onRegenerate(target!.room.id);
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

// ─── Room Pill ────────────────────────────────────────────────────────────────

function RoomPill({
  room,
  types,
  employees,
  assignedUserIds,
  onQrClick,
}: {
  room: RoomRow;
  types: RoomTypeWithRooms[];
  employees: EmployeeOption[];
  assignedUserIds: string[];
  onQrClick: (room: RoomRow) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [localAssigned, setLocalAssigned] = useState<string[]>(assignedUserIds);
  const [, startStatus] = useTransition();
  const [, startDelete] = useTransition();
  const [, startAssign] = useTransition();
  const [editState, editAction, editPending] = useActionState<ActionResult, FormData>(updateRoom, null);
  const [editSubmitted, setEditSubmitted] = useState(false);

  // Sync when server-side assignment set changes (compare by content, not reference)
  const assignedKey = [...assignedUserIds].sort().join(",");
  useEffect(() => {
    setLocalAssigned(assignedUserIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedKey]);
  useEffect(() => { if (editPending) setEditSubmitted(true); }, [editPending]);
  useEffect(() => {
    if (editSubmitted && !editPending && editState === null) {
      setEditSubmitted(false);
      setEditing(false);
    }
  }, [editSubmitted, editPending, editState]);

  const nextStatus: Record<RoomStatus, RoomStatus> = {
    available:   "occupied",
    occupied:    "cleaning",
    cleaning:    "available",
    maintenance: "available",
  };

  if (editing) {
    return (
      <form
        action={editAction}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm flex-wrap"
        style={{ borderColor: "var(--color-primary)", borderWidth: 1.5, background: "var(--color-canvas)" }}
      >
        <input type="hidden" name="id" value={room.id} />
        <Input name="number" defaultValue={room.number} required className="w-16 h-7 text-xs px-2" placeholder="No." />
        <select
          name="room_type_id"
          defaultValue={room.room_type_id}
          className="h-7 rounded border px-1.5 text-xs"
          style={{ borderColor: "var(--color-hairline-input)", color: "var(--color-ink)", background: "var(--color-canvas)" }}
        >
          {types.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
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
        <button type="button" onClick={() => setEditing(false)} style={{ color: "var(--color-ink-mute)" }}>
          <X size={12} />
        </button>
        {editState?.error && (
          <p className="text-xs w-full" style={{ color: "var(--color-ruby)" }}>{editState.error}</p>
        )}
      </form>
    );
  }

  return (
    <div
      className="flex flex-col rounded-lg border text-sm"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      {/* Main row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span style={{ color: "var(--color-ink)", fontWeight: 400 }}>{room.number}</span>
        <button type="button" title="Show QR code" style={{ color: "var(--color-ink-mute)" }} onClick={() => onQrClick(room)}>
          <QrCode size={13} />
        </button>
        <button type="button" title="Edit room" style={{ color: "var(--color-ink-mute)" }} onClick={() => setEditing(true)}>
          <Pencil size={12} />
        </button>
        {employees.length > 0 && (
          <button
            type="button"
            title={localAssigned.length > 0 ? `${localAssigned.length} waiter(s) assigned` : "Assign waiter(s)"}
            style={{ color: localAssigned.length > 0 ? "var(--color-primary)" : "var(--color-ink-mute)" }}
            onClick={() => setAssignOpen((o) => !o)}
          >
            <UserRound size={12} />
          </button>
        )}
        <button
          type="button"
          className="text-xs font-medium"
          style={{ color: STATUS_COLOR[room.status] }}
          title={`Status: ${STATUS_LABEL[room.status]} — click to cycle`}
          onClick={() =>
            startStatus(async () => {
              const r = await setRoomStatus(room.id, nextStatus[room.status]);
              if (r?.error) alert(r.error);
            })
          }
        >
          ●
        </button>
        <button
          type="button"
          style={{ color: "var(--color-ink-mute)" }}
          onClick={() =>
            startDelete(async () => {
              if (confirm(`Delete room ${room.number}?`)) {
                const r = await deleteRoom(room.id);
                if (r?.error) alert(r.error);
              }
            })
          }
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Waiter assignment — multi-select pills */}
      {assignOpen && employees.length > 0 && (
        <div
          className="border-t px-3 pb-2 flex flex-col gap-1"
          style={{ borderColor: "var(--color-hairline)" }}
        >
          <p className="text-xs pt-1.5" style={{ color: "var(--color-ink-mute)" }}>
            Assign waiters (tap to toggle)
          </p>
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
                      await setRoomWaiters(room.id, next);
                    })
                  }
                >
                  {e.display_name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Room Type Waiter Bar ─────────────────────────────────────────────────────

function RoomTypeWaiterBar({
  roomTypeId,
  employees,
  assignedUserIds,
}: {
  roomTypeId: string;
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
        title={localAssigned.length > 0 ? `Type: ${localAssigned.length} waiter(s) assigned` : "Assign type waiter(s)"}
        style={{ color: localAssigned.length > 0 ? "var(--color-primary)" : "var(--color-ink-mute)" }}
        onClick={() => setOpen((o) => !o)}
      >
        <UserRound size={12} />
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
                    await setRoomTypeWaiters(roomTypeId, next);
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

// ─── Room Type Section ────────────────────────────────────────────────────────

function RoomTypeSection({
  type,
  allTypes,
  restaurantId,
  employees,
  assignedByRoom,
  assignedByRoomType,
  onQrClick,
}: {
  type: RoomTypeWithRooms;
  allTypes: RoomTypeWithRooms[];
  restaurantId: string;
  employees: EmployeeOption[];
  assignedByRoom: Record<string, string[]>;
  assignedByRoomType: Record<string, string[]>;
  onQrClick: (room: RoomRow) => void;
}) {
  const [editingType, setEditingType] = useState(false);
  const [, startDelete] = useTransition();
  const [editState, editAction, editPending] = useActionState<ActionResult, FormData>(updateRoomType, null);
  const [addState, addAction, addPending] = useActionState<ActionResult, FormData>(createRoom, null);
  const [editSubmitted, setEditSubmitted] = useState(false);

  useEffect(() => { if (editPending) setEditSubmitted(true); }, [editPending]);
  useEffect(() => {
    if (editSubmitted && !editPending && editState === null) {
      setEditSubmitted(false);
      setEditingType(false);
    }
  }, [editSubmitted, editPending, editState]);

  return (
    <div
      className="rounded-xl border p-5"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      {/* Type header */}
      {editingType ? (
        <form action={editAction} className="flex items-end gap-3 flex-wrap mb-4">
          <input type="hidden" name="id" value={type.id} />
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Type name</label>
            <Input name="name" defaultValue={type.name} required className="w-40 h-8 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Base price / night</label>
            <Input name="base_price" type="number" min="0" step="0.01" defaultValue={type.base_price} className="w-28 h-8 text-sm" />
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Description (optional)</label>
            <Input name="description" defaultValue={type.description ?? ""} className="h-8 text-sm" />
          </div>
          <button
            type="submit"
            disabled={editPending}
            className="text-xs px-3 py-1.5 rounded font-medium h-8"
            style={{ background: "var(--color-primary)", color: "#fff" }}
          >
            {editPending ? "…" : "Save"}
          </button>
          <button type="button" onClick={() => setEditingType(false)} style={{ color: "var(--color-ink-mute)" }}>
            <X size={14} />
          </button>
          {editState?.error && (
            <p className="text-xs w-full" style={{ color: "var(--color-ruby)" }}>{editState.error}</p>
          )}
        </form>
      ) : (
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-sm" style={{ color: "var(--color-ink)" }}>{type.name}</p>
              <RoomTypeWaiterBar
                roomTypeId={type.id}
                employees={employees}
                assignedUserIds={assignedByRoomType[type.id] ?? []}
              />
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
              NPR {type.base_price.toLocaleString()} / night
              {type.description && ` · ${type.description}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setEditingType(true)} style={{ color: "var(--color-ink-mute)" }}>
              <Pencil size={13} />
            </button>
            <button
              type="button"
              style={{ color: "var(--color-ink-mute)" }}
              onClick={() =>
                startDelete(async () => {
                  if (confirm(`Delete room type "${type.name}"? All rooms in this type must be removed first.`)) {
                    const r = await deleteRoomType(type.id);
                    if (r?.error) alert(r.error);
                  }
                })
              }
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Rooms */}
      <div className="flex flex-wrap gap-2 mb-4">
        {type.rooms.map((r) => (
          <RoomPill
            key={r.id}
            room={r}
            types={allTypes}
            employees={employees}
            assignedUserIds={assignedByRoom[r.id] ?? []}
            onQrClick={onQrClick}
          />
        ))}
        {type.rooms.length === 0 && (
          <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>No rooms in this type yet.</p>
        )}
      </div>

      {/* Status legend */}
      {type.rooms.length > 0 && (
        <div className="flex gap-3 mb-4">
          {(Object.entries(STATUS_LABEL) as [RoomStatus, string][]).map(([s, label]) => (
            <span key={s} className="flex items-center gap-1 text-xs" style={{ color: "var(--color-ink-mute)" }}>
              <span style={{ color: STATUS_COLOR[s] }}>●</span> {label}
            </span>
          ))}
        </div>
      )}

      {/* Add room form */}
      <form action={addAction} className="flex items-end gap-2 flex-wrap pt-3 border-t" style={{ borderColor: "var(--color-hairline)" }}>
        <input type="hidden" name="restaurant_id" value={restaurantId} />
        <input type="hidden" name="room_type_id" value={type.id} />
        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Room number</label>
          <Input name="number" placeholder="101, A1…" className="w-28" required />
        </div>
        <Button type="submit" variant="secondary" disabled={addPending}>
          {addPending ? "Adding…" : "Add room"}
        </Button>
        {addState?.error && (
          <p className="text-xs self-end" style={{ color: "var(--color-ruby)" }}>{addState.error}</p>
        )}
      </form>
    </div>
  );
}

// ─── Main Client ──────────────────────────────────────────────────────────────

export function RoomsClient({
  types,
  totalRooms,
  restaurantId,
  restaurantSlug,
  employees,
  assignedByRoom,
  assignedByRoomType,
}: {
  types: RoomTypeWithRooms[];
  totalRooms: number;
  restaurantId: string;
  restaurantSlug: string;
  employees: EmployeeOption[];
  assignedByRoom: Record<string, string[]>;
  assignedByRoomType: Record<string, string[]>;
}) {
  const [qrTarget, setQrTarget] = useState<QrTarget>(null);
  const [, startRegen] = useTransition();
  const [addTypeState, addTypeAction, addTypePending] = useActionState<ActionResult, FormData>(
    createRoomType,
    null
  );

  function handleQrClick(room: RoomRow) {
    const url = restaurantSlug
      ? `${window.location.origin}/c/${restaurantSlug}?room=${room.qr_token}`
      : `${window.location.origin}/c?room=${room.qr_token}`;
    setQrTarget({ room, url });
  }

  function handleRegenerate(roomId: string) {
    startRegen(async () => {
      const r = await regenerateRoomQr(roomId);
      if (r?.error) alert(r.error);
    });
  }

  return (
    <>
      <QrModal target={qrTarget} onClose={() => setQrTarget(null)} onRegenerate={handleRegenerate} />

      <div className="flex flex-col gap-6 max-w-2xl">
        <p className="text-sm -mt-4" style={{ color: "var(--color-ink-mute)" }}>
          {totalRooms} rooms across {types.length} {types.length === 1 ? "type" : "types"}
        </p>

        {types.length === 0 && (
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            No room types yet. Add a room type below to get started.
          </p>
        )}

        {types.map((t) => (
          <RoomTypeSection
            key={t.id}
            type={t}
            allTypes={types}
            restaurantId={restaurantId}
            employees={employees}
            assignedByRoom={assignedByRoom}
            assignedByRoomType={assignedByRoomType}
            onQrClick={handleQrClick}
          />
        ))}

        {/* Add room type */}
        <div
          className="rounded-xl border px-5 py-4"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
        >
          <p className="text-sm font-medium mb-4" style={{ color: "var(--color-ink)" }}>
            Add room type
          </p>
          <form action={addTypeAction} className="flex items-end gap-3 flex-wrap">
            <input type="hidden" name="restaurant_id" value={restaurantId} />
            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Type name</label>
              <Input name="name" placeholder="Standard, Deluxe, Suite…" className="w-40" required />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Base price / night</label>
              <Input name="base_price" type="number" min="0" step="0.01" defaultValue="0" className="w-28" />
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Description (optional)</label>
              <Input name="description" placeholder="King bed, mountain view…" />
            </div>
            <Button type="submit" variant="primary" disabled={addTypePending}>
              {addTypePending ? "Adding…" : "Add type"}
            </Button>
            {addTypeState?.error && (
              <p className="text-xs w-full" style={{ color: "var(--color-ruby)" }}>{addTypeState.error}</p>
            )}
          </form>
        </div>
      </div>
    </>
  );
}
