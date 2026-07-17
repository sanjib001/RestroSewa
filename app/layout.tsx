import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";
import { APPLE_SPLASH } from "@/lib/pwa/apple-splash";
import { cookies } from "next/headers";
import { ThemeSync } from "@/components/ui/theme-sync";

// 500/600 are loaded because 54 files use font-medium/font-semibold. Without the real cuts the
// browser synthesises them — smeared, slightly-too-wide letterforms that read as blurry on the
// dense dashboard tables. Body stays 300 (see globals.css); these are for emphasis only.
const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RestroSewa",
  description: "Hospitality Management Platform",
  applicationName: "RestroSewa",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "RestroSewa",
    // `default` gives black text on our own background. `black-translucent` would
    // slide the page up UNDER the clock and battery — a header rendered behind the
    // status bar, which is a thing you have to then fight with padding.
    statusBarStyle: "default",
  },
  // Nothing here is public; keep it out of search results.
  robots: { index: false, follow: false },

  other: {
    // Next emits only the modern `mobile-web-app-capable`, Chrome's replacement for
    // the vendor-prefixed tag. Safari does not read it. iOS has honoured the
    // manifest's `display: standalone` since 15.4, so a current iPhone is fine
    // either way — but on anything older this tag is the ONLY thing standing
    // between "launches as an app" and "launches in a Safari tab with a URL bar",
    // and it costs one line.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  // Matches --color-canvas-soft (the app's background) so the status bar and the
  // page are one continuous surface with no band of colour between them.
  themeColor: "#f6f9fc",
  width: "device-width",
  initialScale: 1,
  // Lets the layout reach into the notch/home-indicator area. Nothing is drawn
  // there yet — this only makes env(safe-area-inset-*) return real numbers, which
  // Phase 3 needs.
  viewportFit: "cover",
  // Deliberately NOT locking zoom. Pinch-to-zoom is an accessibility affordance,
  // and a waiter squinting at a table number in a dim dining room is exactly the
  // person who needs it.
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const theme = cookieStore.get("theme")?.value || "light";

  return (
    <html lang="en" className={`${inter.variable} ${theme}`}>
      <head>
        {/* Anti-theme-flash inline script */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = document.cookie.split('; ').find(function(row) { return row.startsWith('theme='); })?.split('=')[1] || 'light';
                  var isDashboard = window.location.pathname.startsWith('/admin') || window.location.pathname.startsWith('/employee');
                  if (theme === 'dark' && isDashboard) {
                    document.documentElement.classList.add('dark');
                  } else {
                    document.documentElement.classList.remove('dark');
                  }
                } catch (e) {}
              })()
            `,
          }}
        />
        {/* iOS launch images. Safari matches on an exact device query and shows a
            blank white screen when nothing matches, so these are generated per
            device rather than written by hand — see scripts/generate-pwa-assets.mjs. */}
        {APPLE_SPLASH.map((s) => (
          <link
            key={s.href}
            rel="apple-touch-startup-image"
            href={s.href}
            media={s.media}
          />
        ))}
      </head>
      <body>
        <ThemeSync />
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
