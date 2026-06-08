import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HumanFirst — Front of House",
  description: "The learner-facing front-of-house experience for HumanFirst.",
};

// Prevent a flash of the wrong theme before hydration.
const themeInitScript = `
  (function () {
    try {
      var stored = localStorage.getItem('hf.theme');
      var dark = stored ? stored === 'dark'
        : window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (dark) document.documentElement.classList.add('dark');
    } catch (e) {}
  })();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <meta name="theme-color" content="#1F1B4A" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
