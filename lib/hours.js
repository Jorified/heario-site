// Opening hours: validation, "are we open now?", and when we next open, in the business's own time zone.
// Stored on bots.opening_hours as JSON text: {"tz":"Europe/Dublin","days":{"mon":["09:00","17:30"],"sat":null,...}}
// Empty string = not set (the assistant behaves as before).
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_NAMES = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const SHORT = { Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun" };

const mins = (hhmm) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

export function validTimeZone(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}

// Returns { value: "" | jsonText } or { error }.
export function parseHoursInput(input) {
  if (input === null || input === undefined || input === "" || input === false) return { value: "" };
  if (typeof input !== "object" || !input.days || typeof input.days !== "object") return { error: "Opening hours don't look right. Please set them again." };
  if (!validTimeZone(input.tz)) return { error: "Choose your time zone for the opening hours." };
  const days = {};
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
  return { value: JSON.stringify({ tz: input.tz, days }) };
}

export function readHours(text) {
  if (!text) return null;
  try { const h = JSON.parse(text); return h && validTimeZone(h.tz) && h.days ? h : null; } catch { return null; }
}

// "9am", "5:30pm"
export function clock(hhmm) {
  const t = mins(hhmm === "24:00" ? "23:59" : hhmm);
  const h = Math.floor(t / 60), m = t % 60;
  return `${((h + 11) % 12) + 1}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`;
}

function localNow(tz, now) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now).map((x) => [x.type, x.value])
  );
  return { day: SHORT[p.weekday], minute: Number(p.hour) * 60 + Number(p.minute), label: `${DAY_NAMES[SHORT[p.weekday]]} ${clock(`${p.hour}:${p.minute}`)}` };
}

// { open: true } or { open: false, next: "tomorrow at 9am" } or null if hours aren't set.
export function hoursStatus(hours, now = new Date()) {
  if (!hours) return null;
  const { day, minute, label } = localNow(hours.tz, now);
  const today = hours.days[day];
  if (today && mins(today[0]) <= minute && minute < mins(today[1])) return { open: true, now: label };
  if (today && minute < mins(today[0])) return { open: false, now: label, next: `later today at ${clock(today[0])}`, nextDated: `today at ${clock(today[0])}` };
  const i = DAYS.indexOf(day);
  for (let k = 1; k <= 7; k++) {
    const d = DAYS[(i + k) % 7], h = hours.days[d];
    if (h) return { open: false, now: label, next: `${k === 1 ? "tomorrow" : "on " + DAY_NAMES[d]} at ${clock(h[0])}`, nextDated: `on ${DAY_NAMES[d]} at ${clock(h[0])}` };
  }
  return null;
}

// "Monday 9am-5:30pm, ..., Sunday closed"
export const describeHours = (hours) =>
  DAYS.map((d) => `${DAY_NAMES[d]} ${hours.days[d] ? `${clock(hours.days[d][0])}-${clock(hours.days[d][1])}` : "closed"}`).join(", ");
