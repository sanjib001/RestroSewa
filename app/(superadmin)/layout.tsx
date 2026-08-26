import { requireSuperAdmin } from "@/lib/auth/guards";
import { SuperAdminSidebar } from "./superadmin/_components/sidebar";

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSuperAdmin();

  return (
    <div className="flex min-h-screen" style={{ background: "var(--color-canvas-soft)" }}>
      <SuperAdminSidebar />
      {/* min-w-0 keeps a wide table from stretching the row instead of scrolling
          inside it. pt-12 offsets the fixed mobile top bar; md:pt-0 on desktop,
          where the sidebar replaces it — same as the restaurant admin layout. */}
      <main className="flex-1 min-w-0 overflow-auto pt-12 md:pt-0">{children}</main>
    </div>
  );
}
