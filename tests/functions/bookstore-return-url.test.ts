import { describe, expect, it } from "vitest";
import { isBookstoreReturnUrl } from "../../apps/functions/src/bookstoreCommerce";

describe("bookstore checkout return URLs", () => {
  it.each([
    "https://hi-coworking.com/bookstore/order/abc?session_id={CHECKOUT_SESSION_ID}",
    "https://www.hi-coworking.com/bookstore",
    "https://hi-coworking-plat.web.app/bookstore",
    "https://hi-coworking-plat.firebaseapp.com/bookstore",
    "https://hi-coworking-plat--pr-119-abc123.web.app/bookstore",
    "http://localhost:3000/bookstore",
  ])("allows %s", (url) => expect(isBookstoreReturnUrl(url)).toBe(true));

  it.each([
    "https://evil.example/bookstore",
    "https://hi-coworking.com.evil.example/",
    "http://hi-coworking.com/bookstore",
    "https://evil--hi-coworking-plat.web.app/",
    "javascript:alert(1)",
    "not a url",
  ])("refuses %s", (url) => expect(isBookstoreReturnUrl(url)).toBe(false));
});
