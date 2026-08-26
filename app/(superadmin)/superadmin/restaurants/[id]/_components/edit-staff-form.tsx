"use client";

import { useActionState, useState } from "react";
import { updateStaffMember } from "@/app/actions/staff";
import type { ActionResult } from "@/app/actions/staff";
import type { StaffRow } from "@/app/actions/restaurants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { PermissionPicker } from "./permission-picker";
import { PresetPicker } from "./preset-picker";
import { matchPreset } from "@/lib/permissions";
import type { BusinessType } from "@/lib/business-type";

const PIN_LENGTH = 4;
const KEYPAD = ["1","2","3","4","5","6","7","8","9","","0","⌫"] as const;

function PinEntry({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <div
            key={i}
            className="w-8 h-8 rounded border flex items-center justify-center text-sm font-medium"
            style={{
              borderColor: i < value.length ? "var(--color-primary)" : "var(--color-hairline-input)",
              background: "var(--color-canvas-soft)",
              color: "var(--color-ink)",
            }}
          >
            {i < value.length ? "•" : ""}
          </div>
        ))}
        {value.length > 0 && (
          <button
            type="button"
            className="ml-2 text-xs px-2 rounded"
            style={{ color: "var(--color-ink-mute)" }}
            onClick={() => onChange("")}
          >
            Clear
          </button>
        )}
      </div>
      <div className="grid grid-cols-6 gap-1.5 w-48">
        {KEYPAD.map((key, i) => {
          if (key === "") return <div key={i} />;
          if (key === "⌫") {
            return (
              <button
                key={i}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onChange(value.slice(0, -1))}
                className="col-span-2 h-8 rounded text-sm flex items-center justify-center"
                style={{ background: "var(--color-hairline)", color: "var(--color-ink-mute)" }}
              >⌫</button>
            );
          }
          return (
            <button
              key={i}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => value.length < PIN_LENGTH && onChange(value + key)}
              className="col-span-2 h-8 rounded text-sm flex items-center justify-center"
              style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink)" }}
            >{key}</button>
          );
        })}
      </div>
    </div>
  );
}

export function EditStaffForm({
  staff,
  restaurantId,
  businessType,
  onClose,
}: {
  staff: StaffRow;
  restaurantId: string;
  businessType: BusinessType;
  onClose: () => void;
}) {
  const [role, setRole] = useState<"restaurant_admin" | "restaurant_employee">(
    staff.role === "restaurant_admin" ? "restaurant_admin" : "restaurant_employee"
  );
  const [permissions, setPermissions] = useState<string[]>(
    Array.isArray(staff.permissions) ? staff.permissions : []
  );
  const [newPin, setNewPin] = useState("");
  const [showPin, setShowPin] = useState(false);

  const [state, action, pending] = useActionState<ActionResult, FormData>(updateStaffMember, null);
  const saved = state === null && !pending;

  const labelCls = "text-xs uppercase tracking-wide font-medium";
  const labelStyle = { color: "var(--color-ink-mute)", letterSpacing: "0.06em" };

  return (
    <div
      className="mt-1 mb-2 rounded-xl border px-5 py-5 flex flex-col gap-4"
      style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-primary)", borderWidth: 1.5 }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium min-w-0 truncate" style={{ color: "var(--color-ink)" }}>
          Edit {staff.display_name}
        </p>
        <button type="button" onClick={onClose} style={{ color: "var(--color-ink-mute)" }} className="shrink-0">
          <X size={14} />
        </button>
      </div>

      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="staff_id" value={staff.id} />
        <input type="hidden" name="restaurant_id" value={restaurantId} />
        <input type="hidden" name="auth_user_id" value={staff.auth_user_id ?? ""} />
        <input type="hidden" name="permissions" value={JSON.stringify(role === "restaurant_employee" ? permissions : [])} />
        <input type="hidden" name="new_pin" value={newPin.length === PIN_LENGTH ? newPin : ""} />

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <p className={labelCls} style={labelStyle}>Name</p>
            <Input name="display_name" defaultValue={staff.display_name} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className={labelCls} style={labelStyle}>Job Title</p>
            <Input name="title" defaultValue={staff.title ?? ""} placeholder="Optional" />
          </div>
        </div>

        {/* Role */}
        <div className="flex flex-col gap-1.5">
          <p className={labelCls} style={labelStyle}>System Access</p>
          <div className="flex gap-3">
            {(["restaurant_employee", "restaurant_admin"] as const).map((r) => (
              <label
                key={r}
                className="flex items-center gap-2 cursor-pointer rounded-lg border px-3 py-2 flex-1 text-sm"
                style={{
                  borderColor: role === r ? "var(--color-primary)" : "var(--color-hairline)",
                  background: role === r ? "rgba(99,102,241,0.06)" : "var(--color-canvas)",
                  color: "var(--color-ink)",
                }}
              >
                <input
                  type="radio"
                  name="role"
                  value={r}
                  checked={role === r}
                  onChange={() => setRole(r)}
                  className="sr-only"
                />
                <span>
                  <span className="font-medium block">{r === "restaurant_admin" ? "Admin" : "Staff"}</span>
                  <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                    {r === "restaurant_admin" ? "Full access" : "Permission-based"}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Permissions — employee only */}
        {role === "restaurant_employee" && (
          <div className="flex flex-col gap-2">
            <p className={labelCls} style={labelStyle}>
              Permissions <span className="normal-case ml-1" style={{ color: "var(--color-ink-mute)" }}>({permissions.length} selected)</span>
            </p>
            <div
              className="rounded-lg border px-4 py-3 flex flex-col gap-4"
              style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
            >
              <PresetPicker activeKey={matchPreset(permissions)} onApply={setPermissions} />
              <div className="border-t" style={{ borderColor: "var(--color-hairline)" }} />
              <PermissionPicker selected={permissions} onChange={setPermissions} businessType={businessType} />
            </div>
          </div>
        )}

        {/* Reset PIN */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <p className={labelCls} style={labelStyle}>Reset PIN</p>
            <button
              type="button"
              className="text-xs ml-auto"
              style={{ color: "var(--color-primary)" }}
              onClick={() => { setShowPin(v => !v); setNewPin(""); }}
            >
              {showPin ? "Cancel PIN change" : "Change PIN"}
            </button>
          </div>
          {showPin && (
            <div>
              <p className="text-xs mb-2" style={{ color: "var(--color-ink-mute)" }}>
                Enter new 4-digit PIN
              </p>
              <PinEntry value={newPin} onChange={setNewPin} />
            </div>
          )}
        </div>

        {state && "error" in state && (
          <p className="text-sm" style={{ color: "var(--color-ruby)" }}>{state.error}</p>
        )}

        <div className="flex items-center gap-2 pt-1 border-t" style={{ borderColor: "var(--color-hairline)" }}>
          <Button
            type="submit"
            variant="primary"
            disabled={pending || (showPin && newPin.length > 0 && newPin.length < PIN_LENGTH)}
          >
            {pending ? "Saving…" : "Save changes"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          {saved && <p className="text-xs" style={{ color: "#1a7a4a" }}>Saved</p>}
        </div>
      </form>
    </div>
  );
}
