// Opening hours and holiday closures: validation, "are we open now?", and when we next open,
// in the business's own time zone. Stored on bots.opening_hours as JSON text:
//   {"tz":"Europe/Dublin","days":{"mon":["09:00","17:30"],"sun":null,...} | null,"closed":[["2026-12-24","2027-01-02"]]}
// days = weekly hours (null if not set); closed = date ranges, inclusive. Empty string = nothing set.
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_NAMES = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const SHORT = { Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun" };
export const MAX_CLOSURES = 20;

const mins = (hhmm) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const isDate = (s) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const d = new Date(s + "T00:00:00Z"); return !isNaN(d) && d.toISOString().slice(0, 10) === s; };
const addDays = (ymd, n) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const weekdayOf = (ymd) => DAYS[(new Date(ymd + "T00:00:00Z").getUTCDay() + 6) % 7];

export function validTimeZone(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}

// Returns { value: "" | jsonText } or { error }.
export function parseHoursInput(input) {
  if (input === null || input === undefined || input === "" || input === false) return { value: "" };
  if (typeof input !== "object") return { error: "Opening hours don't look right. Please set them again." };
  let days = null;
  if (input.days) {
    if (typeof input.days !== "object") return { error: "Opening hours don't look right. Please set them again." };
    days = {};
    let any = false;
    for (const d of DAYS) {
      const v = input.days[d];
      if (!v) { days[d] = null; continue; }
      if (!Array.isArray(v) || v.length !== 2) return { error: `Check the opening hours for ${DAY_NAMES[d]}.` };
      let [open, close] = v.map((x) => String(x ?? "").trim());
      if (close === "24:00") close = "23:59";
      const o = mins(open), c = mins(close);
      if (o === null || c === null) return { error: `Enter opening and closing times for ${DAY_NAMES[d]}, or mark it closed.` };
      if (c <= o) return { error: `On ${DAY_NAMES[d]}, the closing time must be after the opening time.` };
      days[d] = [open, close];
      any = true;
    }
    if (!any) return { error: "Mark at least one day as open, or untick opening hours." };
  }
  const closed = [];
  for (const r of Array.isArray(input.closed) ? input.closed : []) {
    const [from, to] = Array.isArray(r) ? r.map((x) => String(x ?? "").trim()) : [];
    if (!from && !to) continue;
    if (!isDate(from) || !isDate(to || from)) return { error: "Enter a start and end date for each closure." };
    if ((to || from) < from) return { error: "A closure's end date must be on or after its start date." };
    if ((Date.parse(to || from) - Date.parse(from)) / 86400000 > 366) return { error: "A closure can be at most a year long." };
    closed.push([from, to || from]);
  }
  if (closed.length > MAX_CLOSURES) return { error: `You can add up to ${MAX_CLOSURES} closures.` };
  if (!days && !closed.length) return { value: "" };
  if (!validTimeZone(input.tz)) return { error: "Choose your time zone for the opening hours." };
  closed.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { value: JSON.stringify({ tz: input.tz, days, closed }) };
}

export function readHours(text) {
  if (!text) return null;
  try {
    const h = JSON.parse(text);
    if (!h || !validTimeZone(h.tz)) return null;
    const closed = Array.isArray(h.closed) ? h.closed : [];
    return h.days || closed.length ? { tz: h.tz, days: h.days || null, closed } : null;
  } catch { return null; }
}

// "9am", "5:30pm"
export function clock(hhmm) {
  const t = mins(hhmm === "24:00" ? "23:59" : hhmm);
  const h = Math.floor(t / 60), m = t % 60;
  return `${((h + 11) % 12) + 1}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`;
}

// "Saturday 3 January" (US time zones: "Saturday, January 3")
export function longDate(ymd, tz) {
  return new Intl.DateTimeFormat(/^America\//.test(tz) ? "en-US" : "en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })
    .format(new Date(ymd + "T00:00:00Z"));
}

function localNow(tz, now) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now).map((x) => [x.type, x.value])
  );
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    day: SHORT[p.weekday],
    minute: Number(p.hour) * 60 + Number(p.minute),
    label: `${DAY_NAMES[SHORT[p.weekday]]} ${clock(`${p.hour}:${p.minute}`)}`,
  };
}

const closureOn = (hours, ymd) => (hours.closed || []).find(([a, b]) => a <= ymd && ymd <= b);

// { open: true } | { open: false, next, nextDated, until? } | null (nothing set).
// next = "tomorrow at 9am"; nextDated names the day instead ("on Monday at 9am"); until = last day of the holiday.
export function hoursStatus(hours, now = new Date()) {
  if (!hours) return null;
  const t = localNow(hours.tz, now);
  const holiday = closureOn(hours, t.date);
  if (!holiday && !hours.days) return { open: true, now: t.label, unknown: true };
  if (!holiday) {
    const today = hours.days[t.day];
    if (today && mins(today[0]) <= t.minute && t.minute < mins(today[1])) return { open: true, now: t.label };
    if (today && t.minute < mins(today[0])) return { open: false, now: t.label, next: `later today at ${clock(today[0])}`, nextDated: `today at ${clock(today[0])}` };
  }
  // Last day of this holiday (closures that run back to back count as one).
  let holidayEnd = holiday ? holiday[1] : null;
  while (holidayEnd) { const more = closureOn(hours, addDays(holidayEnd, 1)); if (!more) break; holidayEnd = more[1]; }
  // Look ahead day by day, skipping closures, for the next opening.
  for (let k = 1; k <= 400; k++) {
    const date = addDays(t.date, k);
    if (closureOn(hours, date)) continue;
    const h = hours.days ? hours.days[weekdayOf(date)] : ["", ""];
    if (!h) continue;
    const at = hours.days ? ` at ${clock(h[0])}` : "";
    const named = k <= 6 && !holiday ? DAY_NAMES[weekdayOf(date)] : longDate(date, hours.tz);
    return {
      open: false, now: t.label, holiday: !!holiday,
      until: holiday ? longDate(holidayEnd, hours.tz) : undefined,
      next: `${k === 1 ? "tomorrow" : "on " + named}${at}`,
      nextDated: `on ${named}${at}`,
    };
  }
  return { open: false, now: t.label, holiday: !!holiday, next: "after the closure", nextDated: "after the closure" };
}

// "Monday 9am-5:30pm, ..., Sunday closed"
export const describeHours = (hours) =>
  hours.days ? DAYS.map((d) => `${DAY_NAMES[d]} ${hours.days[d] ? `${clock(hours.days[d][0])}-${clock(hours.days[d][1])}` : "closed"}`).join(", ") : "";

// Closures that haven't ended yet (within the next ~4 months), for the assistant to mention if asked.
export function upcomingClosures(hours, now = new Date()) {
  if (!hours) return [];
  const today = localNow(hours.tz, now).date, horizon = addDays(today, 120);
  return (hours.closed || [])
    .filter(([a, b]) => b >= today && a <= horizon)
    .map(([a, b]) => (a === b ? longDate(a, hours.tz) : `${longDate(a, hours.tz)} to ${longDate(b, hours.tz)}`));
}
