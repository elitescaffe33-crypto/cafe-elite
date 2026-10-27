const isYes = value => value === true || value === "yes";

export function readChannelConsent(value = {}) {
  return { email: isYes(value.marketing_email_consent ?? value.marketingEmailConsent), sms: isYes(value.marketing_sms_consent ?? value.marketingSmsConsent) };
}

export function consentRecord(value) {
  if (!["marketing_email_consent", "marketingEmailConsent", "marketing_sms_consent", "marketingSmsConsent"].some(key => Object.hasOwn(value || {}, key))) {
    return "Marketing channels v1: email=unknown; sms=unknown";
  }
  const consent = readChannelConsent(value);
  return `Marketing channels v1: email=${consent.email ? "yes" : "no"}; sms=${consent.sms ? "yes" : "no"}`;
}

export function storedConsent(order) {
  // Read the final server-written record, never infer channels from legacy combined consent.
  const records = [...String(order.message || "").matchAll(/^Marketing channels v1: email=(yes|no|unknown); sms=(yes|no|unknown)$/gm)];
  const record = records.at(-1);
  return record ? { email: record[1] === "yes", sms: record[2] === "yes", recorded: record[1] !== "unknown" && record[2] !== "unknown" } : { email: false, sms: false, recorded: false };
}

export function buildMarketingContacts(orders) {
  const contacts = new Map();
  for (const order of [...orders].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))) {
    const email = String(order.email || "").trim().toLowerCase(), phone = String(order.phone || "").trim();
    if (!email && !phone) continue;
    const key = email || phone, consent = storedConsent(order);
    const contact = contacts.get(key) || { name: "", email, phone, marketingEmailConsent: false, marketingSmsConsent: false, channelConsentRecorded: false, orderCount: 0, latestOrderAt: "" };
    contact.name = order.customerName || contact.name;
    contact.email = email || contact.email;
    contact.phone = phone || contact.phone;
    if (consent.recorded) {
      contact.marketingEmailConsent = consent.email;
      contact.marketingSmsConsent = consent.sms;
      contact.channelConsentRecorded = true;
    }
    contact.orderCount++;
    contact.latestOrderAt = order.createdAt || contact.latestOrderAt;
    contacts.set(key, contact);
  }
  return [...contacts.values()].sort((a, b) => b.latestOrderAt.localeCompare(a.latestOrderAt));
}
