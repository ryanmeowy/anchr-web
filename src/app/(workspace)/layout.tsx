import { DemoClaimDialog } from "@/components/app/demo-claim-dialog";
import { DemoTokenProvider } from "@/components/app/demo-token-context";
import { Providers } from "@/components/app/providers";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <DemoTokenProvider>
        {/* No gate and no human check on entry. Every visitor browses with the built-in read-only
            token; the CAPTCHA only appears when someone asks to claim a trial, which is the one
            action that costs anything. */}
        {children}
        <DemoClaimDialog />
      </DemoTokenProvider>
    </Providers>
  );
}
