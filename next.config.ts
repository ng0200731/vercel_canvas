import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.31.31"],
  // Keep sharp out of Next's bundler so it loads its real runtime binary,
  // and force the Linux platform packages into the traced deploy output.
  // Without this, sharp's libvips `.so` is loaded via dlopen at runtime and
  // Next's file tracer (which only follows `require`) drops it, causing
  // "Could not load the sharp module ... ERR_DLOPEN_FAILED" on Vercel.
  serverExternalPackages: ["sharp"],
  outputFileTracingIncludes: {
    "/**/*": [
      "./node_modules/@img/sharp-libvips-linux-x64/**/*",
      "./node_modules/@img/sharp-linux-x64/**/*",
    ],
  },
};

export default nextConfig;
