import { PowerNowPage } from "../PowerNowPage";
import { POWER_NOW_PATHS, canonicalizePowerNowPath } from "@/lib/powerNowLead";

export const dynamicParams = false;

export function generateStaticParams(): Array<{ path: string }> {
  return POWER_NOW_PATHS.map((path) => ({ path }));
}

export default async function PowerNowPathPage({ params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  return <PowerNowPage initialPath={canonicalizePowerNowPath(path)} />;
}
