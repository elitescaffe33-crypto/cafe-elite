const title = document.querySelector("#paymentStatusTitle");
const message = document.querySelector("#paymentStatusMessage");
const time = document.querySelector("#paidCollectionTime");
const collectionDetails = document.querySelector("#paidCollectionDetails");
const reference = document.querySelector("#paidOrderReference");
const referenceDetails = document.querySelector("#paidReferenceDetails");
const session = new URLSearchParams(location.search).get("session_id");
const printConfirmation = document.querySelector("#printOrderConfirmation");
const saveOrderHelp = document.querySelector("#saveOrderHelp");
printConfirmation?.addEventListener?.("click", () => window.print());
try { sessionStorage.removeItem("cafeElitePendingOrder"); } catch { /* Legacy personal data cleanup. */ }

async function verifyPayment() {
  if (!session) {
    title.textContent = "Payment reference missing";
    message.textContent = "No payment reference was supplied. Please speak to the cafe if you have already paid; do not pay again.";
    return;
  }
  try {
    const response = await fetch("/api/payment-status?session_id=" + encodeURIComponent(session));
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "We could not verify your payment.");
    if (result.paid !== true) {
      title.textContent = "Payment not confirmed";
      message.textContent = "Payment is not yet confirmed. Please check with the cafe before trying again.";
      return;
    }
    title.textContent = result.orderReference ? "Order confirmed" : "Payment received";
    message.textContent = result.orderReference ? "Paid online. Please give your name when you collect." : "Your payment is confirmed. Your order confirmation is being processed. Please give your name when you collect.";
    reference.textContent = result.orderReference || "";
    referenceDetails.hidden = !result.orderReference;
    time.textContent = result.collectionTime ? result.collectionTime + " (London time, on the date you ordered)." : "Please confirm your collection time with the cafe.";
    collectionDetails.hidden = false;
    printConfirmation.hidden = false;
    saveOrderHelp.hidden = false;
    try {
      localStorage.removeItem("cafeEliteBasketV1");
      sessionStorage.removeItem("cafeEliteCheckoutAttemptV1");
    } catch { /* Storage failure cannot undo a verified payment. */ }
  } catch {
    title.textContent = "Payment status unavailable";
    message.textContent = "We could not verify your payment right now. Please speak to the cafe before paying again.";
  }
}
verifyPayment();
