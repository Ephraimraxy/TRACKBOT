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

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_R2_PUBLIC_URL: r2PublicUrl ?? "" },
  images: {
    remotePatterns: r2Pattern(),
  },
};

export default nextConfig;
