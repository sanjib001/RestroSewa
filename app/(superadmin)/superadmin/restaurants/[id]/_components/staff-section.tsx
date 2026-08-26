"use client";

import { useState, useTransition } from "react";
import { ExternalLink, ShieldCheck, Pencil, Trash2, PowerOff, Power } from "lucide-react";
import type { StaffRow } from "@/app/actions/restaurants";
import type { BusinessType } from "@/lib/business-type";
import { EditPermissionsForm } from "./edit-permissions-form";
import { EditStaffForm } from "./edit-staff-form";
import { toggleStaffStatus, deleteStaffMember } from "@/app/actions/staff";

function Badge({
  children,
  color = "var(--color-ink-mute)",
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border"
      style={{ color, borderColor: color + "44", background: color + "11", fontSize: 11 }}
    >
      {children}
    </span>
  );
}

function StaffCard({
  s,
  restaurantSlug,
  restaurantId,
  onEdit,
  onEditPermissions,
}: {
  s: StaffRow;
  restaurantSlug: string;
  restaurantId: string;
  onEdit: (s: StaffRow) => void;
  onEditPermissions: (s: StaffRow) => void;
}) {
  const [, startToggle] = useTransition();
  const [, startDelete] = useTransition();

  const initials = s.display_name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const safePermissions = Array.isArray(s.permissions) ? s.permissions : [];

  return (
    <div
      className="flex items-center gap-4 px-4 py-3 rounded-lg border flex-wrap"
      style={{
        background: "var(--color-canvas)",
        borderColor: "var(--color-hairline)",
        opacity: s.is_active ? 1 : 0.55,
      }}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
        style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
      >
        {initials}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>
          {s.display_name}
        </p>
        {s.title && (
          <p className="text-xs truncate" style={{ color: "var(--color-ink-mute)" }}>
            {s.title}
          </p>
        )}
      </div>

      <Badge color={s.role === "restaurant_admin" ? "var(--color-primary)" : "var(--color-ink-mute)"}>
        {s.role === "restaurant_admin" ? "Admin" : "Staff"}
      </Badge>

      {!s.is_active && (
        <Badge color="#d1d5db">Disabled</Badge>
      )}

      {/* Permission count badge — employees only */}
      {s.role === "restaurant_employee" && (
        <button
          type="button"
          title={`${safePermissions.length} permissions — click to edit`}
          onClick={() => onEditPermissions(s)}
          className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors"
          style={{
            borderColor: safePermissions.length > 0 ? "#1a7a4a44" : "var(--color-hairline)",
            background: safePermissions.length > 0 ? "#f0fdf4" : "var(--color-canvas-soft)",
            color: safePermissions.length > 0 ? "#1a7a4a" : "var(--color-ink-mute)",
          }}
        >
          <ShieldCheck size={11} />
          {safePermissions.length}
        </button>
      )}

      <div
        className="w-2 h-2 rounded-full shrink-0"
        title={s.auth_user_id ? "Has login" : "No auth account"}
        style={{ background: s.auth_user_id ? "#1a7a4a" : "#d1d5db" }}
      />

      {/* Edit */}
      <button
        type="button"
        title="Edit staff"
        onClick={() => onEdit(s)}
        style={{ color: "var(--color-ink-mute)" }}
      >
        <Pencil size={13} />
      </button>

      {/* Disable / Enable */}
      <button
        type="button"
        title={s.is_active ? "Disable staff" : "Enable staff"}
        onClick={() =>
          startToggle(async () => {
            await toggleStaffStatus(s.id, s.auth_user_id, !s.is_active, restaurantId);
          })
        }
        style={{ color: s.is_active ? "#b45309" : "#1a7a4a" }}
      >
        {s.is_active ? <PowerOff size={13} /> : <Power size={13} />}
      </button>

      {/* Delete */}
      <button
        type="button"
        title="Delete staff"
        onClick={() => {
          if (
            confirm(
              `Delete ${s.display_name} permanently?\n\nThis removes their account and login for good. This action cannot be undone.`
            )
          ) {
            startDelete(async () => {
              const r = await deleteStaffMember(s.id, s.auth_user_id, restaurantId);
              if (r && "error" in r) alert(r.error);
            });
          }
        }}
        style={{ color: "#dc2626" }}
      >
        <Trash2 size={13} />
      </button>

      {s.auth_user_id && (
        <a
          href={`/login?mode=staff&slug=${restaurantSlug}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs shrink-0"
          style={{ color: "var(--color-ink-mute)" }}
        >
          <ExternalLink size={13} />
        </a>
      )}
    </div>
  );
}

export function StaffSection({
  staff,
  restaurantSlug,
  restaurantId,
  businessType,
}: {
  staff: StaffRow[];
  restaurantSlug: string;
  restaurantId: string;
  businessType: BusinessType;
}) {
  const [editingPermissions, setEditingPermissions] = useState<StaffRow | null>(null);
  const [editingStaff, setEditingStaff] = useState<StaffRow | null>(null);

  const admins    = staff.filter((s) => s.role === "restaurant_admin");
  const employees = staff.filter((s) => s.role === "restaurant_employee");

  return (
    <>
      {editingPermissions && (
        <EditPermissionsForm
          staffId={editingPermissions.id}
          staffName={editingPermissions.display_name}
          restaurantId={restaurantId}
          businessType={businessType}
          initialPermissions={Array.isArray(editingPermissions.permissions) ? editingPermissions.permissions : []}
          onClose={() => setEditingPermissions(null)}
        />
      )}

      <div className="flex flex-col gap-4">
        {admins.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
              Admins
            </p>
            <div className="flex flex-col gap-1.5">
              {admins.map((s) => (
                <div key={s.id}>
                  <StaffCard
                    s={s}
                    restaurantSlug={restaurantSlug}
                    restaurantId={restaurantId}
                    onEdit={(m) => setEditingStaff(m)}
                    onEditPermissions={(m) => setEditingPermissions(m)}
                  />
                  {editingStaff?.id === s.id && (
                    <EditStaffForm
                      staff={s}
                      restaurantId={restaurantId}
                      businessType={businessType}
                      onClose={() => setEditingStaff(null)}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {employees.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
              Staff
            </p>
            <div className="flex flex-col gap-1.5">
              {employees.map((s) => (
                <div key={s.id}>
                  <StaffCard
                    s={s}
                    restaurantSlug={restaurantSlug}
                    restaurantId={restaurantId}
                    onEdit={(m) => setEditingStaff(m)}
                    onEditPermissions={(m) => setEditingPermissions(m)}
                  />
                  {editingStaff?.id === s.id && (
                    <EditStaffForm
                      staff={s}
                      restaurantId={restaurantId}
                      businessType={businessType}
                      onClose={() => setEditingStaff(null)}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {staff.length === 0 && (
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            No staff yet. Add the restaurant admin first.
          </p>
        )}
      </div>
    </>
  );
}
