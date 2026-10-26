import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Forge Agent",
  description: "Local always-on AI software factory"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
