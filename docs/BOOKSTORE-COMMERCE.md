# Hi Coworking Bookstore Commerce

## Purpose

The bookstore is a small, place-first commerce function for Hi Coworking. It supports:

- physical books stocked at Hi Coworking and purchased for on-site pickup;
- digital editions fulfilled through protected access;
- titles available to read in the space but not for sale; and
- curated affiliate titles purchased from external retailers.

Shipping is intentionally outside this first completed pickup release. The order model is designed so shipping can be added without replacing pickup orders.

## Customer lifecycle

### Physical pickup

`Bookstore → title → physical format → live stock check → buy for pickup → inventory reservation → Stripe → signed payment confirmation → order paid → stock sold → ready for pickup → picked up`

A customer does not need a membership account unless the title explicitly requires login. Guest checkout records a hashed high-entropy order access token; the raw token remains in the customer's browser session and is never stored in Firestore.

### Digital

`Bookstore → title → digital format → Stripe → signed payment confirmation → order paid → entitlement granted → protected download`

Authenticated purchasers also receive a compatibility `bookPurchases` record so the existing My Library experience remains usable during migration to the entitlement model.

### External / affiliate

Affiliate titles never create an internal order. The customer follows the retailer link and the existing affiliate-click record is written as non-blocking analytics.

## Authoritative records

### `books/{bookId}`

Catalog content. A book may use the legacy single-format fields or `variants[]`. Physical formats can include:

- `sku`
- `pickupReadyImmediately`
- `pickupLocationIds`

The catalog is not the inventory ledger and is not historical order truth.

### `bookInventory/{locationId}__{bookId}__{variantId}`

Authoritative physical stock at a pickup location:

- `onHand`
- `reserved`
- `reorderAt`
- book/variant/SKU labels for the operating screen

Available inventory is `onHand - reserved`. Public customers receive only `in_stock`, `low_stock`, or `out_of_stock`, not exact counts.

### `bookInventoryAdjustments/{adjustmentId}`

Auditable inventory movements. Receiving stock, sales, returns, damaged units, and manual corrections create ledger entries instead of silently changing counts.

### `bookstoreOrders/{orderId}`

Authoritative commercial order. Each order snapshots the purchased title, format, SKU, price, quantity, customer contact, fulfillment method, pickup details, payment linkage, and timestamps.

The payment ledger references the order through:

- `purpose = bookstore`
- `purposeRefId = orderId`

This replaces the historical payment-to-book relationship for new transactions.

### `bookEntitlements/{orderId}__{bookId}__{variantId}`

Authoritative digital access. Paid digital orders create active entitlements. Refunds revoke them.

## On-site pickup location

Initial location:

- ID: `main`
- Name: Hi Coworking
- Address: 15373 Carrollton Blvd, Carrollton, VA

Physical formats are not sellable for pickup until staff enters actual stock under Admin → Bookstore → Inventory. Migration must never invent physical inventory from the existence of a `physical` catalog record.

## Inventory reservation

A physical checkout reserves stock in the same Firestore transaction that creates the pending order and pending payment ledger record.

Reservation window: 30 minutes.

If Stripe checkout creation fails, the reservation is immediately released. A scheduled cleanup releases abandoned reservations after the reservation window.

This prevents two customers from purchasing the final available copy through concurrent checkout attempts.

## Payment finalization

The browser redirect from Stripe is not authoritative.

`payments/{paymentId}` becoming `paid` is the authoritative trigger. `bookstore_onPaymentUpdated` then:

1. verifies the order/payment relationship;
2. returns immediately if the order was already finalized;
3. converts reserved physical stock into a sale;
4. writes a deterministic inventory sale adjustment;
5. grants digital entitlements when applicable;
6. sets the fulfillment status; and
7. creates an in-app notification for authenticated users.

If a payment arrives after a reservation was released, finalization rechecks current inventory. It never drives stock negative. If the copy is no longer available, the paid order becomes `inventory_exception` for staff resolution/refund.

## Pickup lifecycle

Normal immediate shelf stock:

`paid → ready_for_pickup → picked_up`

Prepared orders:

`paid → awaiting_prep → ready_for_pickup → picked_up`

Exception:

`paid → inventory_exception`

Only server callables may transition pickup status. Staff cannot mark an unpaid order picked up, and an order must be ready before it can be marked picked up.

## Refund boundary

This release supports staff cancellation/refund before pickup:

- pending checkout: reservation released; payment marked failed/cancelled;
- paid but not picked up: idempotent Stripe refund, stock restored for physical products, digital entitlement revoked, payment ledger marked refunded;
- picked up: automated refund is blocked because a physical return must be received/assessed first.

A fuller post-pickup return policy can be added after the business return window/condition rules are approved.

## Customer surfaces

- `/bookstore` — editorial catalog
- `/bookstore/item?id=...` — static-export-safe book detail and checkout
- `/bookstore/order` — post-Stripe confirmation and pickup status
- `/account/orders` — authenticated order history
- `/library` — existing digital library, retained during migration

The canonical catalog does not depend on creating a new static `/bookstore/[id]` route for every title. Historical generated detail routes redirect to the query-parameter detail page when present in the current static build.

## Staff/admin surfaces

- `/admin/bookstore` — catalog
- `/admin/bookstore/inventory` — receive/correct on-site stock
- `/admin/bookstore/orders` — pickup fulfillment and pre-pickup refund queue

## Security boundaries

New order, inventory, adjustment, and entitlement writes are server-authoritative through Firebase Admin SDK callables/triggers. No client Firestore write rule is opened for those collections.

Published book catalog reads retain the existing public rule. Administrative book editing retains the existing admin-only catalog write rule.

Guest order reads require the hashed-token proof through a callable instead of making order documents publicly readable.

## Current boundaries / future extensions

Not included in the initial pickup-complete release:

- parcel shipping and carrier labels;
- post-pickup return intake/restocking condition workflow;
- automatic Stripe Tax configuration;
- a dedicated transactional email provider integration.

Authenticated users receive existing in-app notifications. Guest order confirmation remains available in the purchasing browser via the protected order token. Transactional email can be attached to the order events without changing the order or inventory model.
