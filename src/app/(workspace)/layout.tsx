import { DemoClaimDialog } from "@/components/app/demo-claim-dialog";
import { DemoTokenProvider } from "@/components/app/demo-token-context";
import { DemoVerificationGate } from "@/components/app/demo-verification-gate";
import { Providers } from "@/components/app/providers";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <DemoTokenProvider>
        {/* The human check runs at the door and issues nothing. Claiming a trial token stays an
            explicit action from the sidebar. */}
        <DemoVerificationGate>
          {children}
          <DemoClaimDialog />
        </DemoVerificationGate>
      </DemoTokenProvider>
    </Providers>
  );
}
