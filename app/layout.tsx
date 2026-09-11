import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import "./globals.css";

export const metadata: Metadata = {
  title: "Post-it",
  description: "Multi-tenant knowledge garden",
};

/**
 * Without this a phone renders the page at about 980px and scales the result
 * down, so every screen was a legible desktop layout shrunk to illegibility.
 * Nothing else in the mobile work matters until this is here: media queries are
 * measured against the viewport width, and there was no viewport to measure.
 *
 * No maximum-scale and no user-scalable=no: pinch-zoom is how people read small
 * text, and taking it away to keep a layout tidy is not a trade this product
 * gets to make.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * The footer lives here rather than on the front page.
 *
 * It started on the front page alone, which was a misreading: the credit and
 * the letterbox belong on every page, not only the one a stranger lands on.
 * Anybody already signed in and reading their own notes never saw either.
 *
 * `.page` exists to be the thing that grows, so that on a short page the footer
 * sits at the bottom of the window instead of floating under two lines of text.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="page">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
