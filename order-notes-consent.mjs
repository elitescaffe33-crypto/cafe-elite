// Never edit an issued version: add a new version and retain the old statement.
export const ORDER_NOTES_CONSENT = Object.freeze({
  version: "order-notes-explicit-2026-10-27-v1",
  statement: "I explicitly consent to CAFFE ELITE LTD using any food-allergy or health information I choose to include in these order notes solely to assess, prepare and hand over this order. I can withdraw my consent by contacting elitescaffe33@gmail.com or 07423 772364. A written note does not guarantee that my allergy request can be safely accommodated.",
  scope: "optional_order_notes_food_allergy_or_health_information",
  purpose: "assess_prepare_and_hand_over_this_order",
});

export const NOTES_CONSENT_ERROR = "Please give explicit consent for these notes, or remove the notes to continue without sharing them.";

export function orderNotesConsentEvidence(orderId, recordedAt) {
  return { orderId, granted: true, recordedAt, statementVersion: ORDER_NOTES_CONSENT.version,
    statement: ORDER_NOTES_CONSENT.statement, scope: ORDER_NOTES_CONSENT.scope,
    purpose: ORDER_NOTES_CONSENT.purpose, method: "separate_unchecked_checkbox" };
}
