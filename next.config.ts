import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server prints every Server Action invocation together with its
  // serialised arguments. connectRiotCredentials takes the Riot password as an
  // argument, so that logging writes the plaintext credential to the terminal —
  // defeating the transit-only guarantee the login provider is built around
  // (roadmap Version 2.4: the credential is "never logged"). The provider keeps
  // its own contract; this closes the framework-level leak around it.
  logging: {
    incomingRequests: false,
  },
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
