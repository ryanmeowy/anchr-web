import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const premiumThemeBootstrap = `
(() => {
  try {
    const storedTheme = window.localStorage.getItem("anchr.theme");
    const theme = storedTheme === "light" || storedTheme === "dark"
      ? storedTheme
      : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.premiumTheme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {}
})();
`;

export const metadata: Metadata = {
  title: "Anchr",
  description: "知识库问答工作台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full" suppressHydrationWarning>
      <body className="min-h-full">
        <script
          id="anchr-theme-bootstrap"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: premiumThemeBootstrap }}
        />
        {children}
      </body>
    </html>
  );
}
