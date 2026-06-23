export const defaultSiteSettings = {
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

  menuPrices: {},
  menuCustom: {
    hiddenItems: [],
    customItems: [],
  },
};

export let siteSettings = defaultSiteSettings;

export function setSiteSettings(nextSettings) {
  siteSettings = mergeSettings(defaultSiteSettings, nextSettings || {});
}

export function mergeSettings(base, overrides) {
  const output = Array.isArray(base) ? [...base] : { ...base };

  Object.entries(overrides || {}).forEach(([key, value]) => {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      output[key] = mergeSettings(base[key], value);
      return;
    }

    output[key] = value;
  });

  return output;
}

export const dayKeys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function timeToMinutes(time) {
  const [hours, minutes] = String(time || "00:00")
    .split(":")
    .map((part) => Number(part));
  return hours * 60 + minutes;
}

export function getOrderingStatus(date = new Date(), settings = siteSettings) {
  if (!settings.ordering.enabled) {
    return {
      isOpen: false,
      message: settings.ordering.closedMessage,
      today: null,
    };
  }

  const weekday = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    timeZone: settings.timezone,
  })
    .format(date)
    .toLowerCase();
  const today = settings.ordering.days[weekday];

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
    timeZone: settings.timezone,
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
