# Microsoft 365 administrative marketing email

## Product boundary

This module is optional and is exclusively for authorized Hi-Coworking administrators to send marketing and outreach messages from one centrally controlled Microsoft 365 mailbox.

It does **not** provide member mailbox integration. Registration does not create or connect a Microsoft mailbox. There is no delegated member OAuth flow, member-facing compose button, organization-created campaign, member-to-member email, or arbitrary sender address.

The server-authoritative capability is `adminMarketingEmail`:

- `master` users have the capability as the super-administrator override.
- Other administrators must receive the explicit custom claim `adminMarketingEmail: true`.
- `admin`, `staff`, organization owner, and review-administrator status do not imply marketing authority.
- The capability is granted or removed only by the master-only `adminMarketing_setCapability` callable.

The marketing module is not used for password resets, account verification, security alerts, Stripe notices, receipts, claim decisions, RFx deadlines, bid submissions, awards, legal notices, or other required transactional communications.

## Deployment independence

No Microsoft credential is declared with `defineSecret`, and no Microsoft credential is evaluated while unrelated Functions are loaded or deployed. The module reads its secret only after an authorized administrator invokes an actual send.

Therefore, missing Microsoft configuration does not prevent deploying or operating:

- profile saving;
- enrichment;
- organization creation;
- organization claims;
- review administration;
- seed review;
- Opportunity Discovery;
- the Exchange map;
- Firestore rules and indexes;
- Hosting.

The Firebase Functions deployment entry is `lib/firebaseEntry.js`; Firebase runs the Functions build as a predeploy step so stale generated JavaScript cannot reintroduce removed provider code.

## Microsoft architecture

Use one dedicated Microsoft Entra application with application-only Microsoft Graph access:

1. Create a dedicated Entra application for Hi-Coworking administrative marketing email.
2. Add the Microsoft Graph **application** permission `Mail.Send`.
3. Grant tenant administrator consent.
4. Create or designate one Microsoft 365 marketing mailbox.
5. Scope the application to only that mailbox with Exchange Online Application RBAC, using the current supported resource-scoping process.
6. Add each approved sender alias as a proxy address on the designated mailbox.
7. Enable tenant alias sending:

   ```powershell
   Set-OrganizationConfig -SendFromAliasEnabled $true
   ```

8. Confirm every sender alias and Reply-To address through controlled external test delivery.

The provider calls:

```text
POST https://graph.microsoft.com/v1.0/users/{mailbox-UPN}/sendMail
```

It uses client-credential authentication and never accepts a delegated user token or member credential.

## Confidential credential

The default Secret Manager name is:

```text
MICROSOFT_MARKETING_CLIENT_SECRET
```

Create it in the intended Firebase/Google Cloud project and grant the Functions runtime service account `Secret Manager Secret Accessor` only for that secret. A different secret name may be recorded in the Firestore configuration document.

Do not put the client secret in Git, a `NEXT_PUBLIC_*` variable, a browser request, a campaign document, or logs.

A certificate credential should replace the development client secret when the deployment environment and operational process support certificate rotation cleanly.

## Server-controlled configuration

Create the server-only document:

```text
systemConfig/adminMarketingEmail
```

Example development configuration:

```json
{
  "enabled": true,
  "environment": "development",
  "tenantId": "<entra-tenant-id>",
  "clientId": "<entra-application-id>",
  "mailboxUpn": "marketing@hi-coworking.com",
  "clientSecretName": "MICROSOFT_MARKETING_CLIENT_SECRET",
  "senderAliases": [
    "hello@hi-coworking.com",
    "founders@hi-coworking.com"
  ],
  "defaultSenderAlias": "hello@hi-coworking.com",
  "approvedReplyTo": [
    "hello@hi-coworking.com"
  ],
  "developmentRecipientAllowlist": [
    "<controlled-external-test-recipient>"
  ],
  "unsubscribeBaseUrl": "https://hi-coworking-plat.web.app/email-preferences",
  "maxRecipientsPerSend": 100,
  "rateLimitRecipientsPerHour": 250
}
```

Keep `enabled: false` or `environment: disabled` until tenant permissions, mailbox scope, aliases, unsubscribe routing, and the controlled recipient allowlist are complete.

The browser cannot read or write this document directly; the callable returns only safe operational fields.

## Consent and suppression

A recipient is eligible only when the server-side user document contains a recorded marketing preference similar to:

```json
{
  "marketingEmail": {
    "status": "subscribed",
    "source": "documented_opt_in",
    "evidenceReference": "<reference-to-approved-consent-record>",
    "updatedAt": 0,
    "updatedBy": "<administrator-or-self-service>"
  }
}
```

Supported states are:

- `subscribed`;
- `unsubscribed`;
- `suppressed`;
- `bounced`.

No status is invented from registration, Terms acceptance, organization membership, or a missing field. A subscribed status without a recorded source is excluded.

Administrators, staff, and master accounts are excluded from member campaigns by default. In development, every recipient must also appear in the server-controlled development allowlist.

Each live campaign message receives an opaque, one-use preference token. Only the token hash is stored. The public `/email-preferences` route applies `unsubscribed` through a protected callable.

## Sender and content safeguards

The server enforces:

- marketing capability authorization;
- sender-alias allowlisting;
- Reply-To allowlisting;
- explicit consent and suppression filtering;
- segment eligibility;
- development recipient allowlisting;
- per-send recipient caps;
- per-administrator hourly recipient limits;
- bounded subject and message lengths;
- plain-text input escaped into safe HTML;
- recipient-count confirmation;
- idempotency and campaign claiming;
- one Graph message per recipient so addresses are not disclosed to other recipients;
- bounded audit metadata without broadly readable recipient lists or full bodies.

The browser cannot submit Microsoft credentials, arbitrary Graph parameters, arbitrary sender headers, or authoritative recipient records.

## Alias acceptance

A Graph `202 Accepted` response proves only that Graph accepted the request. It does not prove the recipient saw the selected alias.

For each alias:

1. Send a test to a controlled external recipient.
2. Inspect the recipient-visible **From** and **Reply-To** values and received headers.
3. Record the result through `adminMarketing_recordAliasVerification`.
4. Do not claim alias acceptance until the displayed From address matches the approved alias.

If the tenant cannot preserve the alias through the supported configuration, do not spoof headers. Use distinct dedicated or shared mailboxes for sender identities that require distinct visible From addresses.

## Administrative interface

The capability-protected interface is:

```text
/admin/marketing/email
```

It supports safe configuration status, approved aliases, approved Reply-To choices, campaign drafts, eligible recipient preview, selected subscribed members, controlled test sending, explicit confirmation, idempotent delivery, and bounded history.

It is not shown in ordinary member navigation and contains no mailbox connection workflow.

## Event campaigns

`/admin/events/campaigns` is limited to push and in-app event notifications. Legacy event campaign records containing `email` or `sms` are rejected until those channels are removed. The old SendGrid and Twilio providers and secret bindings have been removed.

## Future SMS

The channel contract reserves an `sms` name so an administrator-controlled SMS provider can be added later without replacing marketing authorization, consent, suppression, rate-limit, idempotency, and audit services.

No SMS provider, phone acquisition, member texting, consent assumption, or SMS billing is implemented now.

## Acceptance checklist

Microsoft administrative marketing email is accepted only after all of the following are evidenced:

- master and explicitly authorized marketing admins are allowed;
- ordinary admins without the capability are denied;
- review admins, staff, organization owners, and ordinary members are denied;
- signup creates no Microsoft mailbox or marketing capability;
- no member OAuth or mailbox connection exists;
- Application RBAC limits the application to the designated mailbox;
- arbitrary sender and Reply-To addresses are rejected;
- explicit subscription, unsubscribe, suppression, bounce, and development allowlist filtering pass;
- a controlled test is accepted by Graph;
- the recipient-visible alias and Reply-To are independently verified;
- duplicate-send protection passes;
- audit records are written;
- missing Microsoft configuration leaves core Exchange deployment and operation unaffected.
