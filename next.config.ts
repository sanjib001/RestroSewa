import type { NextConfig } from "next";

// Restaurant logos live in Supabase Storage, so `next/image` has to be told the
// bucket's host is trusted — otherwise every logo throws at render. Derived from
// the project URL rather than hard-coded, so a new Supabase project just works.
//
// The PROTOCOL has to be derived too, not assumed. Hosted Supabase is always
// https, but a self-hosted stack behind its own gateway may serve plain http —
// and `next/image` matches remotePatterns on protocol as well as host, so an
// assumed "https" silently rejects every logo on such a deployment.
const supabaseImageHost = (() => {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return { hostname: url.hostname, protocol: url.protocol.replace(":", "") as "http" | "https" };
  } catch {
    return null;
  }
})();

// Push is configured by three environment variables, and the failure mode when they
// are missing is uniquely nasty: everything BUILDS, everything RUNS, every screen
// looks right — and no phone ever rings. There is no error to find, because nothing
// errored.
//
// The public key is worse still, because `NEXT_PUBLIC_*` values are INLINED AT BUILD
// TIME. A host that sets the variable after deploying has not fixed anything: the
// bundle already shipped with `undefined` baked into it, and only a rebuild changes
// that. So the check belongs here, in the build, where it can still be acted on.
(() => {
  const missing = [
    "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
  ].filter((k) => !process.env[k]);

  if (missing.length > 0) {
    console.warn(
      "\n\x1b[33m⚠ WEB PUSH IS NOT CONFIGURED — this build cannot send notifications.\x1b[0m\n" +
        `  Missing: ${missing.join(", ")}\n` +
        "  The app will build and run fine, and no phone will ever ring.\n" +
        "  NEXT_PUBLIC_VAPID_PUBLIC_KEY is baked in at BUILD time — set it on the host\n" +
        "  BEFORE building, or the bundle ships without it no matter what you set later.\n"
    );
  }
})();

const nextConfig: NextConfig = {
  skipProxyUrlNormalize: true,

  experimental: {
    serverActions: {
      // Next's own default (1MB) is stricter than this app's advertised/enforced
      // logo limit (branding.ts MAX_BYTES = 2MB) and is checked BEFORE the action
      // runs — so a 1-2MB photo (most real phone camera JPGs) never even reaches
      // the action's own friendly "over 2MB" message; Next rejects it outright
      // with a 413. 3mb leaves headroom for multipart boundary/field overhead on
      // top of the 2MB the app itself allows.
      bodySizeLimit: "3mb",
    },
    // Both are BARREL packages: `radix-ui` is an umbrella that re-exports every
    // primitive it has, and lucide-react re-exports well over a thousand icons. An
    // `import { Slot } from "radix-ui"` or `import { Bell } from "lucide-react"` is
    // therefore, before tree-shaking, a request for the entire library — and the
    // bundler then has to prove it can drop the rest, which it cannot always do
    // across a barrel.
    //
    // This rewrites those imports to reach for the one module they actually need. It
    // matters most on the customer menu, which is the largest client component in the
    // app AND the one thing a guest downloads over restaurant wifi on their own phone.
    optimizePackageImports: ["lucide-react", "radix-ui"],
  },

  images: {
    remotePatterns: supabaseImageHost
      ? [{ ...supabaseImageHost, pathname: "/storage/v1/object/public/**" }]
      : [],
  },

  // `pg` powers the real-time LISTEN connection (lib/realtime/bus.ts). It does
  // dynamic requires (pg-native, TLS shims) that break when bundled, so it must
  // be loaded from node_modules at runtime rather than compiled into the server
  // bundle. Without this the listener silently fails to connect and every
  // dashboard quietly falls back to the slow poll.
  serverExternalPackages: ["pg"],

  async headers() {
    return [
      {
        // A service worker that gets cached is a service worker you cannot replace:
        // the browser checks /sw.js for an update, a CDN answers from cache with the
        // old bytes, and the old worker keeps serving the app — across reloads, across
        // deploys. Pin it to no-store so a new release is always actually reachable.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      {
        // Generated art, and its name never changes — but the bytes might, when the
        // mark is redrawn. A day is long enough to be free on a phone and short
        // enough that a rebrand lands without asking anyone to clear their cache.
        source: "/icons/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
      {
        source: "/splash/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
    ];
  },
};

export default nextConfig;
