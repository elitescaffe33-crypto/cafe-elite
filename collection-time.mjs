import { defaultSiteSettings, getOrderingStatus, timeToMinutes } from "./site-settings.mjs";

export function getCafeHours(date = new Date(), settings = defaultSiteSettings) {
  const timezone = settings.timezone || "Europe/London";
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: timezone }).format(date).toLowerCase();
  const clock = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: timezone,
  }).format(date);
  const [hour, minute, second] = clock.split(":").map(Number);
  const today = settings.ordering.days[weekday];
  const minutes = hour * 60 + minute;
  const hasHours = today && /^\d{2}:\d{2}$/.test(today.open || "") && /^\d{2}:\d{2}$/.test(today.close || "");
  return {
    weekday, today, minutes, second,
    isOpen: Boolean(hasHours && minutes >= timeToMinutes(today.open) && minutes < timeToMinutes(today.close)),
    label: hasHours ? `Open today ${today.open} - ${today.close}` : "View opening hours",
  };
}

export function getCollectionWindow(date = new Date(), settings = defaultSiteSettings) {
  const status = getOrderingStatus(date, settings);
  const hours = getCafeHours(date, settings);
  if (!status.isOpen || !hours.today) return { available: false, message: status.message, min: "", max: "" };
  // The preparation estimate is advisory, not a minimum booking lead time.
  // Customers may request a collection time this minute or any later available minute.
  // The last-order cutoff still controls when orders may be placed.
  const configuredPreparation = Number(settings.ordering.preparationMinutes);
  const prep = Number.isInteger(configuredPreparation) && configuredPreparation >= 15 && configuredPreparation <= 60
    ? configuredPreparation : 15;
  const earliest = Math.max(timeToMinutes(hours.today.open), hours.minutes);
  const closing = timeToMinutes(hours.today.close);
  const latest = Math.min(1439, Math.max(closing, timeToMinutes(hours.today.lastOrder) + prep));
  if (!Number.isFinite(earliest) || !Number.isFinite(latest) || earliest > latest) {
    return { available: false, message: "No collection times remain today. You can still browse the menu.", min: "", max: "" };
  }
  const format = value => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  const min = format(earliest), max = format(latest);
  return {
    available: true, min, max,
    message: "Please note: collection orders usually take around 15 minutes or longer to prepare, especially during busy periods.",
  };
}

export function validateCollectionTime(value, date = new Date(), settings = defaultSiteSettings) {
  const window = getCollectionWindow(date, settings);
  if (!window.available) return window.message;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""))) return "Choose your preferred collection time.";
  if (value < window.min || value > window.max) return `Choose a time between ${window.min} and ${window.max} today (London time).`;
  return "";
}
