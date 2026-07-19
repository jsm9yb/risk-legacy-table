import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const image = new URL("/og.png", origin).toString();

  return {
    title: "Risk Legacy — Private Campaign Table",
    description: "A private digital table for a three-to-five-player Risk Legacy campaign.",
    openGraph: {
      title: "Risk Legacy — Private Campaign Table",
      description: "Prepare the world, pass the device, and carry the permanent consequences through every game.",
      images: [{ url: image, width: 1733, height: 909, alt: "Risk Legacy private campaign table" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Risk Legacy — Private Campaign Table",
      description: "A private digital table for a three-to-five-player Risk Legacy campaign.",
      images: [image],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
