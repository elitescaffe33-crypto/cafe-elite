// A five-digit, database-assigned number is for customers and staff only.
// The original UUID remains the durable primary key and Stripe/webhook identity.
export function visibleOrderReference(order) {
  const number = order?.orderNumber;
  if (Number.isSafeInteger(number) && number >= 10000 && number <= 99999) {
    return String(number);
  }
  // The legacy or disposable file store may have no assigned customer number.
  // Never fabricate or truncate a UUID into a potentially colliding numeric code.
  return typeof order?.id === "string" ? order.id : "";
}
