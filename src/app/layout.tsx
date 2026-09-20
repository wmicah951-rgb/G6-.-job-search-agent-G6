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
          {/* min-w-0 lets the scrollable strip below actually shrink instead of stretching
              this row (and the whole page) past the viewport on a narrow screen. */}
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-4 min-w-0">
            <a href="/" className="shrink-0 font-bold text-base tracking-tight text-neutral-900 flex items-center gap-1.5">
              <span>⚡</span>
              <span>Job Search Agent</span>
            </a>
            <div className="nav-scroll flex items-center gap-5 overflow-x-auto min-w-0">
              <a href="/" className="shrink-0 text-sm text-neutral-600 hover:text-neutral-900 font-medium">Dashboard</a>
              <a href="/jobs/new" className="shrink-0 text-sm text-neutral-600 hover:text-neutral-900 font-medium">Add Posting</a>
              <a href="/upload" className="shrink-0 text-sm text-neutral-600 hover:text-neutral-900 font-medium">Resume &amp; Preferences</a>
              <a href="/testlab" className="shrink-0 text-sm text-neutral-600 hover:text-neutral-900 font-medium">Test Lab</a>
              <a href="/harness" className="shrink-0 text-sm text-neutral-600 hover:text-neutral-900 font-medium">Harness</a>
            </div>
          </div>
        </nav>
        <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">{children}</main>

      </body>
    </html>
  );
}
