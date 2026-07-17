# Stripe test-mode setup

## Product and price

In the Stripe test-mode dashboard create:

- Product: `Hi-Coworking Exchange Founding Membership`
- Price: `$49.00 USD`, recurring monthly

Set server configuration:

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
firebase functions:config:set STRIPE_FOUNDING_PRICE_ID=price_test_value APP_URL=https://test.example.com
```

For current Firebase parameter tooling, supply `STRIPE_FOUNDING_PRICE_ID` and `APP_URL` when prompted at deploy or in the project-specific functions environment file. They are server-side parameters. Do not expose `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, or the webhook body to the browser.

## Webhook

Deploy `stripe_webhook` and configure its HTTPS URL in Stripe test mode. Subscribe to:

- `checkout.session.completed`
- `checkout.session.expired`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Local forwarding:

```bash
stripe login
stripe listen --forward-to http://127.0.0.1:5004/PROJECT/us-east1/stripe_webhook
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
```

Use Stripe test card `4242 4242 4242 4242`, any future expiry, any CVC, and a valid postal code. The success route must remain pending until the signed webhook arrives.

## Test sequence

1. Register and open `/exchange/onboarding`.
2. Search, select, or create an organization.
3. Continue to `/exchange/membership?organizationId=...` as its owner/admin.
4. Start Founding Checkout and complete the test subscription.
5. Confirm `organizationMemberships/{orgId}` is active, has a unique founder number, and stores Stripe customer/subscription/price/period fields.
6. Confirm one `organizationCreditLots/stripe_invoice_{invoiceId}` and matching ledger entry exist with 25 credits and a 12-month expiration.
7. Replay the event and invoice; neither founder count nor credits may change.

## Moving to live mode later

Create a distinct live product/price, replace only deployment secrets and `STRIPE_FOUNDING_PRICE_ID`, configure a live webhook endpoint/signing secret, and run a controlled reconciliation. Do not copy test customer/subscription IDs into live membership records. Live mode is out of Week 1 scope.
