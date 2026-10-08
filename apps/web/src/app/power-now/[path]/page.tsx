import { PowerNowPage } from "../PowerNowPage";
import { POWER_NOW_PATHS } from "@/lib/powerNowLead";

export const dynamicParams = false;

export function generateStaticParams(): Array<{ path: string }> {
  return POWER_NOW_PATHS.map((path) => ({ path }));
}

export default function PowerNowPathPage() {
  return <PowerNowPage />;
}
