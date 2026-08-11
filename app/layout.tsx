import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TeachAgent — Visual Learning",
  description: "Mini NotebookLM — learn visually with Excalidraw + AI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
