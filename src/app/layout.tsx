import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Kargo Hiring",
  description: "Ranked PM and SPM shortlist for Arjun. The system ranks and explains; Arjun decides.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen`}>
        <header className="bg-kargo text-white">
          <div className="mx-auto max-w-6xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/" className="font-semibold tracking-tight text-lg">
              Kargo <span className="font-normal text-white/70">Hiring</span>
            </Link>
            <nav className="flex gap-4 text-sm text-white/85">
              <Link href="/" className="hover:text-white">Dashboard</Link>
              <Link href="/upload" className="hover:text-white">Upload CVs</Link>
              <Link href="/bulk-send" className="hover:text-white">Bulk send</Link>
            </nav>
            <span className="ml-auto text-xs text-white/60 hidden sm:block">
              The system ranks and explains. You decide.
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
