import { AssetPreviewPremiumPage } from "@/features/preview/asset-preview-premium-page";

export default async function Page({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  const { assetId } = await params;

  return <AssetPreviewPremiumPage assetId={assetId} />;
}
