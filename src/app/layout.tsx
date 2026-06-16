import type { Metadata } from "next";
import "./globals.css";

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
      <body className="min-h-full">{children}</body>
    </html>
  );
}
