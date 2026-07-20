import {
  getPublicOrganizationsForExchange,
  type PublicOrganizationProjection,
} from "@/lib/firestore";

let cachedOrganizations: Promise<PublicOrganizationProjection[]> | null = null;

/**
 * Reuse the same bounded discovery request across Exchange mode switches.
 * A rejected request is never cached, and an explicit refresh supersedes it.
 */
export async function loadPublicOrganizationsForExchange({
  force = false,
  maxResults = 10_000,
}: {
  force?: boolean;
  maxResults?: number;
} = {}): Promise<PublicOrganizationProjection[]> {
  if (force || !cachedOrganizations) {
    const request = getPublicOrganizationsForExchange(maxResults);
    cachedOrganizations = request;
    try {
      return await request;
    } catch (error) {
      if (cachedOrganizations === request) cachedOrganizations = null;
      throw error;
    }
  }
  return cachedOrganizations;
}
