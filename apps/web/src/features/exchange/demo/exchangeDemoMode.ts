export function resolveExchangeDemoMode(
  nodeEnv: string | undefined,
  requested: string | undefined,
): boolean {
  return nodeEnv !== "production" && requested === "true";
}

export function isExchangeDemoMode(): boolean {
  return resolveExchangeDemoMode(
    process.env.NODE_ENV,
    process.env.NEXT_PUBLIC_EXCHANGE_DEMO_MODE,
  );
}
