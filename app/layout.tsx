import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Inter } from "next/font/google";
import { Nav } from "@/components/site/nav";
import { Footer } from "@/components/site/footer";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
  weight: ["500", "600", "700", "800"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  // Pages set a bare title; the template appends the brand.
  title: {
    default: "Flo — Point of sale built for the rush",
    template: "%s — Flo",
  },
  description:
    "Flo is a complete point of sale for payments, inventory, and staff. Ring up orders in seconds, keep stock honest, and see every location in one place.",
  openGraph: {
    title: "Flo — Point of sale built for the rush",
    description:
      "Ring up orders in seconds, keep stock honest, and see every location in one place.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#04040a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Reveal animations start hidden, so show everything if JS never runs */}
        <noscript>
          <style>{`[data-reveal]{opacity:1!important;transform:none!important;filter:none!important}`}</style>
        </noscript>
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
