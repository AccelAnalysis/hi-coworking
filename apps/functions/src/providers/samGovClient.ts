const SAM_GOV_ENTITY_ENDPOINT = "https://api.sam.gov/entity-information/v4/entities";
const SAM_GOV_ENTITY_SECTIONS = "entityRegistration,coreData";
const SAM_GOV_ENTITY_PAGE_SIZE = 10;

export type SamGovEntitySearchParams = {
  businessName: string;
  city?: string;
  state?: string;
  uei?: string;
  cage?: string;
};

export type SamGovEntityRecord = {
  legalName: string;
  city?: string;
  state?: string;
  uei?: string;
  cage?: string;
  registrationStatus?: string;
  registrationExpirationDate?: string;
  businessTypes: string[];
};

export type SamGovSafeError = {
  status: number;
  message?: string;
  detail?: string;
  errorCode?: string;
  transactionId?: string;
  errorName?: string;
};

export type SamGovEntitySearchResult =
  | { status: "ok"; entities: SamGovEntityRecord[] }
  | { status: "unavailable"; entities: []; error: SamGovSafeError };

type FetchImplementation = typeof fetch;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  if (!cleaned || cleaned.toLowerCase() === "null") return undefined;
  return cleaned;
}

function normalizeState(value?: string): string | undefined {
  const cleaned = cleanString(value);
  if (!cleaned) return undefined;
  return /^[A-Za-z]{2}$/.test(cleaned) ? cleaned.toUpperCase() : cleaned;
}

function redactErrorValue(value: unknown, apiKey: string): string | undefined {
  const cleaned = cleanString(value);
  if (!cleaned) return undefined;
  return cleaned
    .replaceAll(apiKey, "[REDACTED]")
    .replace(/api_key=[^&\s]+/gi, "api_key=[REDACTED]")
    .slice(0, 500);
}

function parseBusinessTypes(coreData: UnknownRecord | undefined): string[] {
  const businessTypes = asRecord(coreData?.businessTypes);
  const rows = Array.isArray(businessTypes?.businessTypeList)
    ? businessTypes.businessTypeList
    : [];
  const sbaRows = Array.isArray(businessTypes?.sbaBusinessTypeList)
    ? businessTypes.sbaBusinessTypeList
    : [];

  return Array.from(new Set([...rows, ...sbaRows]
    .map((row) => cleanString(asRecord(row)?.businessTypeDesc)
      ?? cleanString(asRecord(row)?.sbaBusinessTypeDesc))
    .filter((value): value is string => Boolean(value))));
}

export function buildSamGovEntitySearchUrl(
  params: SamGovEntitySearchParams,
  apiKey: string,
): URL {
  const key = apiKey.trim();
  if (!key) throw new Error("SAM.gov API key is required");

  const url = new URL(SAM_GOV_ENTITY_ENDPOINT);
  url.searchParams.set("api_key", key);
  url.searchParams.set("includeSections", SAM_GOV_ENTITY_SECTIONS);
  url.searchParams.set("page", "0");
  url.searchParams.set("size", String(SAM_GOV_ENTITY_PAGE_SIZE));

  const uei = cleanString(params.uei);
  const cage = cleanString(params.cage);
  if (uei) {
    url.searchParams.set("ueiSAM", uei.toUpperCase());
    return url;
  }
  if (cage) {
    url.searchParams.set("cageCode", cage.toUpperCase());
    return url;
  }

  url.searchParams.set("legalBusinessName", params.businessName.trim());
  const city = cleanString(params.city);
  const state = normalizeState(params.state);
  if (city) url.searchParams.set("physicalAddressCity", city);
  if (state) url.searchParams.set("physicalAddressProvinceOrStateCode", state);
  return url;
}

export function parseSamGovEntityResponse(
  payload: unknown,
  fallbackBusinessName: string,
): SamGovEntityRecord[] {
  const root = asRecord(payload);
  const rows = Array.isArray(root?.entityData) ? root.entityData : [];

  return rows.flatMap((row) => {
    const entity = asRecord(row);
    if (!entity) return [];
    const registration = asRecord(entity.entityRegistration);
    const coreData = asRecord(entity.coreData);
    const physicalAddress = asRecord(coreData?.physicalAddress);
    const legalName = cleanString(registration?.legalBusinessName)
      ?? fallbackBusinessName.trim();
    if (!legalName) return [];

    const city = cleanString(physicalAddress?.city);
    const state = normalizeState(cleanString(physicalAddress?.stateOrProvinceCode));
    const uei = cleanString(registration?.ueiSAM);
    const cage = cleanString(registration?.cageCode);
    const registrationStatus = cleanString(registration?.registrationStatus);
    const registrationExpirationDate = cleanString(registration?.registrationExpirationDate);

    return [{
      legalName,
      ...(city ? { city } : {}),
      ...(state ? { state } : {}),
      ...(uei ? { uei } : {}),
      ...(cage ? { cage } : {}),
      ...(registrationStatus ? { registrationStatus } : {}),
      ...(registrationExpirationDate ? { registrationExpirationDate } : {}),
      businessTypes: parseBusinessTypes(coreData),
    }];
  });
}

async function parseSamGovError(
  response: Response,
  apiKey: string,
): Promise<SamGovSafeError> {
  let body: UnknownRecord | undefined;
  try {
    body = asRecord(await response.json());
  } catch {
    body = undefined;
  }

  return {
    status: response.status,
    ...(redactErrorValue(body?.message ?? body?.title, apiKey)
      ? { message: redactErrorValue(body?.message ?? body?.title, apiKey) }
      : {}),
    ...(redactErrorValue(body?.detail ?? body?.details, apiKey)
      ? { detail: redactErrorValue(body?.detail ?? body?.details, apiKey) }
      : {}),
    ...(redactErrorValue(body?.errorCode, apiKey)
      ? { errorCode: redactErrorValue(body?.errorCode, apiKey) }
      : {}),
    ...(redactErrorValue(body?.transaction_id, apiKey)
      ? { transactionId: redactErrorValue(body?.transaction_id, apiKey) }
      : {}),
  };
}

export async function requestSamGovEntities(
  params: SamGovEntitySearchParams,
  apiKey: string,
  options: {
    fetchImpl?: FetchImplementation;
    timeoutMs?: number;
  } = {},
): Promise<SamGovEntitySearchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const url = buildSamGovEntitySearchUrl(params, apiKey);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return {
        status: "unavailable",
        entities: [],
        error: await parseSamGovError(response, apiKey),
      };
    }

    const payload = await response.json();
    return {
      status: "ok",
      entities: parseSamGovEntityResponse(payload, params.businessName),
    };
  } catch (error) {
    return {
      status: "unavailable",
      entities: [],
      error: {
        status: 0,
        message: "SAM.gov request could not be completed",
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
    };
  }
}
