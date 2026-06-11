import { readJson } from "./database.js";

const IST_TIME_ZONE = "Asia/Kolkata";
const DEFAULT_HOLIDAYS = new Set();

function istParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function istDateKey(date = new Date()) {
  const parts = istParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function istMinutes(date = new Date()) {
  const parts = istParts(date);
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function configuredHolidays() {
  const envHolidays = (process.env.NSE_HOLIDAYS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const fileHolidays = readJson("market-holidays.json", { holidays: [] }).holidays ?? [];
  return new Set([...DEFAULT_HOLIDAYS, ...envHolidays, ...fileHolidays]);
}

function nextWeekdayOpen(date = new Date()) {
  const next = new Date(date);
  const skipToday = istMinutes(date) >= 15 * 60 + 30;
  for (let index = 0; index < 10; index += 1) {
    next.setDate(next.getDate() + (index === 0 && !skipToday ? 0 : 1));
    const parts = istParts(next);
    const key = istDateKey(next);
    if (parts.weekday !== "Sat" && parts.weekday !== "Sun" && !configuredHolidays().has(key)) {
      return `${key}T09:15:00+05:30`;
    }
  }
  return null;
}

export function getMarketSession(date = new Date()) {
  const parts = istParts(date);
  const dateKey = istDateKey(date);
  const minutes = istMinutes(date);
  const holidays = configuredHolidays();
  const weekend = parts.weekday === "Sat" || parts.weekday === "Sun";
  const holiday = holidays.has(dateKey);
  const closedDay = weekend || holiday;

  let phase = "closed";
  if (!closedDay) {
    if (minutes >= 9 * 60 && minutes < 9 * 60 + 15) {
      phase = "preopen";
    } else if (minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 29) {
      phase = "open";
    } else if (minutes >= 15 * 60 + 40 && minutes <= 16 * 60) {
      phase = "closing";
    }
  }

  return {
    date: dateKey,
    weekday: parts.weekday,
    phase,
    marketOpen: phase === "open",
    freshEntriesAllowed: phase === "open" && minutes >= 9 * 60 + 20 && minutes < 15 * 60,
    squareOffDue: phase === "open" && minutes >= 15 * 60 + 15,
    botArmAllowed:
      !closedDay &&
      (phase === "preopen" ||
        (phase === "closed" && minutes < 9 * 60 + 15) ||
        (phase === "open" && minutes < 15 * 60)),
    closedDay,
    weekend,
    holiday,
    reason: weekend ? "Weekend" : holiday ? "Exchange holiday" : phase === "closed" ? "Outside market hours" : "Trading session",
    nextOpenAt: phase === "closed" || closedDay ? nextWeekdayOpen(date) : null,
    holidays: [...holidays].sort(),
  };
}

export function isMarketOpen(date = new Date()) {
  return getMarketSession(date).marketOpen;
}
