import { DemoClaimDialog } from "@/components/app/demo-claim-dialog";
import { DemoTokenProvider } from "@/components/app/demo-token-context";
import { Providers } from "@/components/app/providers";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      {/* No gate: a visitor may browse without a token. Claiming is an explicit action from the
          sidebar, so merely looking around never spends a trial. */}
      <DemoTokenProvider>
        {children}
        <DemoClaimDialog />
      </DemoTokenProvider>
    </Providers>
  );
}
