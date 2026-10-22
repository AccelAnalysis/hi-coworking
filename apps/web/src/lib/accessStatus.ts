export type AccessStatusSummary = {
  grantStatus: string;
  codeStatus: string | null;
  doorName: string;
  codeLast2?: string | null;
  startsAt: number;
  endsAt: number;
  deliveryStatus?: string;
  programmingStatus?: string;
  staffAttentionRequired?: boolean;
};

export function accessMessage(access?: AccessStatusSummary, now = Date.now()): string {
  if (!access) return "Access is not ready yet. Contact Hi Coworking if details are still missing before arrival.";
  if (access.grantStatus === "revoked" || access.grantStatus === "expired" || access.endsAt <= now) {
    return "This access credential is no longer valid.";
  }
  if (access.staffAttentionRequired || access.codeStatus === "failed" || access.programmingStatus === "blocked" || access.deliveryStatus === "failed") {
    return "Your booking is confirmed, but access needs staff attention. Contact Hi Coworking before arrival.";
  }
  if (access.grantStatus === "active" && access.codeStatus === "active") {
    const timing = now < access.startsAt ? "programmed for your upcoming access window" : "active";
    const delivery = access.deliveryStatus === "delivered" ? "Delivery confirmed." : "Email delivery is not confirmed; contact staff if you have not received your code.";
    return `Your ${access.doorName} credential is ${timing}. ${delivery}`;
  }
  return "Your access credential is being programmed, not yet ready. Check again before arrival or contact staff.";
}
