import { Providers } from "@/components/app/providers";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
