import type { Metadata } from "next";
import "./globals.css";

const premiumThemeBootstrap = `
(() => {
  try {
    const theme = "dark";
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
