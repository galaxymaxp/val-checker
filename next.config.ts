import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        hostname: "media.valorant-api.com",
        pathname: "/**",
        protocol: "https",
      },
    ],
  },
  poweredByHeader: false,
};

export default nextConfig;
