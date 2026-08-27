# Hi Coworking booking experience alignment

The customer booking journey belongs to the original Hi Coworking website model deployed from this repository.

## Public navigation

The primary public navigation remains:

**Spaces · Pricing · Events · Bookstore · About · Contact**

`Book a Space` is a transaction reached from **Spaces** and other contextual calls to action. It is not a seventh primary public-navigation section.

## Customer path

Spaces → live availability → select desk or meeting setup → authoritative quote → membership hours/account credit/payment → confirmation.

Post-booking management is located under **Account → Bookings**. The legacy `/my-hi` path is retained only as a redirect for old bookmarks.

## Transaction requirements

- Server-authoritative availability and pricing.
- Atomic holds for the selected period.
- Membership-hours and account-credit reservations are consumed only when the booking is confirmed.
- Stripe is completed before a paid booking becomes confirmed.
- Cancellation is retry-safe across refund, credit, membership restoration, booking cancellation, and access revocation.
- Rescheduling preserves the original booking until availability and replacement access are ready.
- The retired direct-booking endpoint fails closed.
