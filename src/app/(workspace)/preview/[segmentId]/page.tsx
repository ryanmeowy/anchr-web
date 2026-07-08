import { PreviewPremiumPage } from "@/features/preview/preview-premium-page";

export default async function Page({
  params,
}: {
  params: Promise<{ segmentId: string }>;
}) {
  const { segmentId } = await params;

  return <PreviewPremiumPage segmentId={segmentId} />;
}
