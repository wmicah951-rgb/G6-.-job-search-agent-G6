import type { Metadata } from "next";
import "./globals.css";

// NOTE: next/font/google (Geist) needs network access to fonts.googleapis.com.
// Swapped to system fonts so this builds in network-restricted environments;
// swap back to next/font/google freely once deployed on Vercel if desired.

export const metadata: Metadata = {
  title: "Job Search Agent",
  description: "Agentic job-posting evaluator with a human approval gate",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900">
        <nav className="border-b border-neutral-200 bg-white sticky top-0 z-40">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <a href="/" className="font-bold text-base tracking-tight text-neutral-900 flex items-center gap-1.5">
                <span>⚡</span>
                <span>Job Search Agent</span>
              </a>
              <a href="/" className="text-sm text-neutral-600 hover:text-neutral-900 font-medium">Dashboard</a>
              <a href="/jobs/new" className="text-sm text-neutral-600 hover:text-neutral-900 font-medium">Add Posting</a>
              <a href="/upload" className="text-sm text-neutral-600 hover:text-neutral-900 font-medium">Resume &amp; Preferences</a>
            </div>
          </div>
        </nav>
        <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">{children}</main>

      </body>
    </html>
  );
}
