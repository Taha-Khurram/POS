import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // A payment screenshot rides on the checkout submit, and a phone
      // screenshot is routinely 2–3 MB. The default 1 MB refused most of them
      // before `MAX_PROOF_BYTES` (5 MB) was ever consulted; the headroom is
      // multipart overhead.
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
