import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Night.Market Watch",
  description: "Build a watchlist from the VALORANT skin catalog.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
