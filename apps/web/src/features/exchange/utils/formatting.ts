export function formatExchangeDate(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "Not specified";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function formatExchangeCount(count: number, noun: string): string {
  return `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`;
}

export function titleCaseExchangeStatus(status: string): string {
  return status
    .split("_")
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}
