import type { Metadata } from "next";
import "./globals.css";

// Static metadata, so that every page can be exported as plain HTML. SITE_URL is the public address
// of the site (set by the deployment workflow); it makes the preview-image URL absolute.
const siteUrl = process.env.SITE_URL ?? "http://localhost:3000/";
const previewImage = "og-color-texture-v4.png";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`),
  title: "Color and Texture Demonstrations — IACV Lecture 4",
  description:
    "Interactive demonstrations for students of Image Analysis and Computer Vision (ETH Zürich, HS 2026), Lecture 4: Color and Texture. Created by Güney Tombak as a learning aid; not an official ETH Zürich website.",
  authors: [{ name: "Güney Tombak" }],
  openGraph: {
    title: "Interactive Color and Texture Demonstrations",
    description: "Eleven interactive demonstrations accompanying IACV Lecture 4: Color and Texture.",
    type: "website",
    images: [{ url: previewImage, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Interactive Color and Texture Demonstrations",
    description: "Color spaces, cone responses, gamut mapping, color constancy, illumination invariants, texture characteristics, Fourier features, GLCMs, Laws energy, Gabor filters, and eigenfilters.",
    images: [previewImage],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
