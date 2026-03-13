function dateToIso(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isoToUtcDate(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`);
}

function addDays(iso: string, days: number) {
  const d = isoToUtcDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return dateToIso(d);
}

function observedHoliday(year: number, monthIndex: number, day: number) {
  const d = new Date(Date.UTC(year, monthIndex, day));
  const dow = d.getUTCDay();
  if (dow === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  } else if (dow === 0) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dateToIso(d);
}

function nthWeekdayOfMonth(year: number, monthIndex: number, weekday: number, nth: number) {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const delta = (weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + delta + (nth - 1) * 7;
  return dateToIso(new Date(Date.UTC(year, monthIndex, day)));
}

function lastWeekdayOfMonth(year: number, monthIndex: number, weekday: number) {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  const delta = (last.getUTCDay() - weekday + 7) % 7;
  last.setUTCDate(last.getUTCDate() - delta);
  return dateToIso(last);
}

function easterSunday(year: number) {
  // Gregorian algorithm (Meeus/Jones/Butcher)
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function goodFriday(year: number) {
  const easter = easterSunday(year);
  easter.setUTCDate(easter.getUTCDate() - 2);
  return dateToIso(easter);
}

function nyseHolidaySetForYear(year: number) {
  const set = new Set<string>();
  set.add(observedHoliday(year, 0, 1)); // New Year's Day
  set.add(nthWeekdayOfMonth(year, 0, 1, 3)); // MLK Day (3rd Monday Jan)
  set.add(nthWeekdayOfMonth(year, 1, 1, 3)); // Presidents' Day (3rd Monday Feb)
  set.add(goodFriday(year)); // Good Friday
  set.add(lastWeekdayOfMonth(year, 4, 1)); // Memorial Day (last Monday May)
  set.add(observedHoliday(year, 5, 19)); // Juneteenth
  set.add(observedHoliday(year, 6, 4)); // Independence Day
  set.add(nthWeekdayOfMonth(year, 8, 1, 1)); // Labor Day (1st Monday Sep)
  set.add(nthWeekdayOfMonth(year, 10, 4, 4)); // Thanksgiving (4th Thursday Nov)
  set.add(observedHoliday(year, 11, 25)); // Christmas
  return set;
}

function nyseHolidaySetAroundYear(year: number) {
  const set = new Set<string>();
  for (const y of [year - 1, year, year + 1]) {
    const ys = nyseHolidaySetForYear(y);
    ys.forEach((v) => set.add(v));
  }
  return set;
}

function isWeekend(isoDate: string) {
  const d = isoToUtcDate(isoDate);
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

export function isNyseTradingDay(isoDate: string) {
  const year = Number.parseInt(isoDate.slice(0, 4), 10);
  const holidays = nyseHolidaySetAroundYear(year);
  return !isWeekend(isoDate) && !holidays.has(isoDate);
}

function getNyNowParts(now: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(now);
  const lookup = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const year = lookup("year");
  const month = lookup("month");
  const day = lookup("day");
  const hour = Number.parseInt(lookup("hour"), 10);
  const minute = Number.parseInt(lookup("minute"), 10);

  return {
    isoDate: `${year}-${month}-${day}`,
    hour,
    minute
  };
}

export function getExpectedLatestCloseDate(now: Date = new Date()) {
  const ny = getNyNowParts(now);
  const afterClose = ny.hour > 16 || (ny.hour === 16 && ny.minute >= 0);
  let candidate = ny.isoDate;

  if (!(afterClose && isNyseTradingDay(candidate))) {
    candidate = addDays(candidate, -1);
  }

  while (!isNyseTradingDay(candidate)) {
    candidate = addDays(candidate, -1);
  }

  return candidate;
}

export function nextDate(isoDate: string) {
  return addDays(isoDate, 1);
}

export function shiftDate(isoDate: string, days: number) {
  return addDays(isoDate, days);
}
