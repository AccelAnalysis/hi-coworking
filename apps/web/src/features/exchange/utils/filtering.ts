const NAICS_CODE_PATTERN = /^\d{2,6}$/;

export function parseExchangeNaicsDraft(value: string, maximum = 20): string[] {
  const codes = new Set<string>();
  for (const candidate of value.split(/[\s,]+/)) {
    const code = candidate.trim();
    if (!NAICS_CODE_PATTERN.test(code)) continue;
    codes.add(code);
    if (codes.size >= maximum) break;
  }
  return [...codes];
}
