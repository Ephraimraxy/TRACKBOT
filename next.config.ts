import type { NextConfig } from "next";

// Product and avatar images are served from the public URL of the R2 bucket
// (NEXT_PUBLIC_R2_PUBLIC_URL, e.g. https://pub-xxxx.r2.dev or a custom domain).
// R2_PUBLIC_URL is accepted as an alias and exposed to the browser as NEXT_PUBLIC_R2_PUBLIC_URL.
const r2PublicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? process.env.R2_PUBLIC_URL;

function r2Pattern() {
  const raw = r2PublicUrl;
  if (!raw) return [];
  try {
    const url = new URL(raw);
    return [
      {
        protocol: url.protocol.replace(":", "") as "http" | "https",
        hostname: url.hostname,
        port: url.port,
        pathname: `${url.pathname.replace(/\/$/, "")}/**`,
      },
    ];
  } catch {
    return [];
  }
}

// Headers sent with every response. A full Content-Security-Policy is not set because the map tiles,
// image storage and Next.js inline scripts would each need a hand-tuned allowance (see the report, 5.4).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Only this site may ask for the position (the delivery person's phone); camera and microphone are never used.
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  env: { NEXT_PUBLIC_R2_PUBLIC_URL: r2PublicUrl ?? "" },
  images: {
    remotePatterns: r2Pattern(),
  },
};

export default nextConfig;
