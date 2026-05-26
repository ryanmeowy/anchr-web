import { PreviewPage } from "@/features/preview/preview-page";

export default async function Page({
  params,
}: {
  params: Promise<{ segmentId: string }>;
}) {
  const { segmentId } = await params;

  return <PreviewPage segmentId={segmentId} />;
}
