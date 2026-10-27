import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "30DAYS | Accelerate · RVCE",
  description: "Accelerate presents 30DAYS — a focused 30-day LeetCode challenge for RVCE students.",
  applicationName: "Accelerate 30DAYS",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#04050a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Warm the TLS connection to the API before the first fetch. The dashboard
  // fires its request only after auth resolves, so this hides most of the
  // handshake on a cold or mobile connection.
  let apiOrigin: string | null = null;
  try {
    const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
    if (configured) apiOrigin = new URL(configured).origin;
  } catch {
    apiOrigin = null;
  }
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {apiOrigin && <link rel="preconnect" href={apiOrigin} crossOrigin="anonymous" />}
        {apiOrigin && <link rel="dns-prefetch" href={apiOrigin} />}
        {children}
      </body>
    </html>
  );
}
