# Opportunity communication routing

Opportunity and procurement communication uses purpose `opportunities` (or `rfx_responses` for response intake):

1. establishment-specific procurement route;
2. organization opportunity route;
3. active response-team members;
4. active owner/admin members;
5. in-app fallback.

The route resolver is callable independently by authenticated, server-validated Actor context and is available to existing opportunity workflows. It returns the same privacy-minimized result as referral routing. RFx authorization, response documents, billing, and Microsoft administrative marketing remain separate boundaries.
