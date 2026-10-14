import { hash } from "./credentials.mjs";

// Prices and entitlement decisions are always made on the server.
export const PRODUCT = Object.freeze({
  name: "シゴデキ先生 アプリ本体",
  price: 980,
  currency: "JPY",
});
const COUPON_DISCOUNT = 50000;
export function couponMatches(value, configured) {
  return (
    typeof value === "string" &&
    value.length <= 100 &&
    Boolean(configured) &&
    hash(value.trim()) === hash(configured)
  );
}
export function freeQuote() {
  return {
    ...PRODUCT,
    couponDiscount: COUPON_DISCOUNT,
    appliedDiscount: Math.min(PRODUCT.price, COUPON_DISCOUNT),
    total: Math.max(0, PRODUCT.price - COUPON_DISCOUNT),
  };
}
