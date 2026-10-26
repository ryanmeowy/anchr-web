import { DemoTokenGate } from "@/components/app/demo-token-gate";
import { Providers } from "@/components/app/providers";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <DemoTokenGate>{children}</DemoTokenGate>
    </Providers>
  );
}
