export const siteSettings = {
  timezone: "Europe/London",

  ordering: {
    enabled: true,
    closedMessage: "Online ordering is currently closed. Please order during opening hours.",
    days: {
      monday: { label: "Monday", open: "09:00", close: "16:00", lastOrder: "15:45" },
      tuesday: { label: "Tuesday", open: "09:00", close: "16:00", lastOrder: "15:45" },
      wednesday: { label: "Wednesday", open: "09:00", close: "16:00", lastOrder: "15:45" },
      thursday: { label: "Thursday", open: "09:00", close: "16:00", lastOrder: "15:45" },
      friday: { label: "Friday", open: "09:00", close: "16:00", lastOrder: "15:45" },
      saturday: { label: "Saturday", open: "09:00", close: "16:00", lastOrder: "15:45" },
      sunday: { label: "Sunday", open: "10:00", close: "15:00", lastOrder: "14:45" },
    },
  },

  services: {
    collection: true,
    delivery: false,
  },

  payments: {
    payOnCollection: true,
    stripe: true,
  },
};

export const dayKeys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function timeToMinutes(time) {
  const [hours, minutes] = String(time || "00:00")
    .split(":")
    .map((part) => Number(part));
  return hours * 60 + minutes;
}

export function getOrderingStatus(date = new Date()) {
  if (!siteSettings.ordering.enabled) {
    return {
      isOpen: false,
      message: siteSettings.ordering.closedMessage,
      today: null,
    };
  }

  const weekday = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    timeZone: siteSettings.timezone,
  })
    .format(date)
    .toLowerCase();
  const today = siteSettings.ordering.days[weekday];

  if (!today) {
    return {
      isOpen: false,
      message: "Online ordering is currently closed.",
      today: null,
    };
  }

  const currentTime = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: siteSettings.timezone,
  }).format(date);

  const now = timeToMinutes(currentTime);
  const open = timeToMinutes(today.open);
  const lastOrder = timeToMinutes(today.lastOrder);

  if (now < open) {
    return {
      isOpen: false,
      message: `Online ordering opens today at ${today.open}.`,
      today,
    };
  }

  if (now > lastOrder) {
    return {
      isOpen: false,
      message: `Online ordering is closed. Last orders today were at ${today.lastOrder}.`,
      today,
    };
  }

  return {
    isOpen: true,
    message: `Online ordering open until ${today.lastOrder}.`,
    today,
  };
}
