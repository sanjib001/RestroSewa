"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function ThemeSync() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.documentElement;
    const isDashboard =
      pathname.startsWith("/admin") ||
      pathname.startsWith("/employee") ||
      // Excludes /superadmin/login — that's (superadmin-auth), a different
      // route group under the same URL prefix, and logins stay light below.
      (pathname.startsWith("/superadmin") && !pathname.startsWith("/superadmin/login"));
    const isCustomer = pathname.startsWith("/c/");

    if (isDashboard) {
      // Staff/admin theme is a per-user choice, stored in a cookie and toggled in the UI.
      const themeCookie = document.cookie.split("; ").find((c) => c.startsWith("theme="));
      const theme = themeCookie ? themeCookie.split("=")[1] : "light";
      root.classList.toggle("dark", theme === "dark");
      return;
    }

    if (isCustomer) {
      // The customer QR menu has no toggle — a guest is anonymous — so it follows the DEVICE's
      // colour scheme, and re-applies live if the guest flips their phone to dark mid-browse.
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const apply = () => root.classList.toggle("dark", mq.matches);
      apply();
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }

    // Marketing / login stay light regardless of device.
    root.classList.remove("dark");
  }, [pathname]);

  return null;
}
