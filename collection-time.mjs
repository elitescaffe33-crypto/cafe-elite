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
  // Last-order time limits when the order can be PLACED, not when it can be collected.
  // The owner's normal preparation target is 15–20 min; allow approximately 20 min.
  const configuredPreparation = Number(settings.ordering.preparationMinutes);
  const prep = Number.isInteger(configuredPreparation) && configuredPreparation >= 15 && configuredPreparation <= 60
    ? configuredPreparation : 20;
  const earliest = Math.max(timeToMinutes(hours.today.open), hours.minutes + prep);
  const closing = timeToMinutes(hours.today.close);
  const latest = Math.min(1439, Math.max(closing, timeToMinutes(hours.today.lastOrder) + prep));
  if (!Number.isFinite(earliest) || !Number.isFinite(latest) || earliest > latest) {
    return { available: false, message: "No collection times remain today. You can still browse the menu.", min: "", max: "" };
  }
  const format = value => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  const min = format(earliest), max = format(latest);
  const lateNotice = latest > closing ? " Late collection after normal closing is subject to cafe confirmation." : "";
  return {
    available: true, min, max,
    message: `Today, ${min} - ${max} (London time). Please allow about ${prep} minutes for preparation.${lateNotice}`,
  };
}

export function validateCollectionTime(value, date = new Date(), settings = defaultSiteSettings) {
  const window = getCollectionWindow(date, settings);
  if (!window.available) return window.message;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""))) return "Choose a collection time for today.";
  if (value < window.min || value > window.max) return `Choose a time between ${window.min} and ${window.max} today (London time).`;
  return "";
}
