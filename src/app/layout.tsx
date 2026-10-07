import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CAPEX Project Management",
  description: "Lean CAPEX project management application",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-slate-100 text-slate-950">
        <div className="min-h-screen">
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-2">
              <Link href="/projects" aria-label="Kaizen Project Management" className="min-w-0">
                <Image
                  src="/logo.png"
                  alt="Kaizen Project Management"
                  width={1333}
                  height={797}
                  priority
                  className="h-auto w-[130px] max-w-[55vw] object-contain sm:w-[150px]"
                />
              </Link>
              <nav aria-label="Main navigation" className="flex items-center gap-2 text-sm font-medium">
                <Link href="/projects" className="rounded-lg bg-slate-900 px-3 py-2 text-white">
                  Projects
                </Link>
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
