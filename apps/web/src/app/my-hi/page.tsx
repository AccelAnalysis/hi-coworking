/**
 * My Hi lives at /my-hi. Stripe Checkout returns here with
 * ?payment=success&plan=..., the billing portal returns here, and the welcome
 * email links here, so render the page in place (no client redirect, so the
 * query string and the URL stay intact). /account/bookings renders the same
 * page for older links.
 */
export { default } from "../account/bookings/page";
