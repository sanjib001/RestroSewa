import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  skipProxyUrlNormalize: true,

  // `pg` powers the real-time LISTEN connection (lib/realtime/bus.ts). It does
  // dynamic requires (pg-native, TLS shims) that break when bundled, so it must
  // be loaded from node_modules at runtime rather than compiled into the server
  // bundle. Without this the listener silently fails to connect and every
  // dashboard quietly falls back to the slow poll.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
