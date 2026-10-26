export const PAYROLL_ZONE = "America/Los_Angeles";
export function submissionDeadline(month: string, value = new Date()) {
  const [year, monthNumber] = month.slice(0, 7).split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const prefix = year + "-" + String(monthNumber).padStart(2, "0");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PAYROLL_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(value);
  const now = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const today = now.year + "-" + now.month + "-" + now.day;
  const monthName = new Intl.DateTimeFormat("en-US", {month: "long", timeZone: "UTC"})
    .format(new Date(Date.UTC(year, monthNumber - 1, 1)));
  const lastDate = prefix + "-" + String(lastDay).padStart(2, "0");
  return {
    open: today >= prefix + "-27",
    late: today > lastDate || (today === lastDate && Number(now.hour) * 60 + Number(now.minute) >= 720),
    opensLabel: monthName + " 27",
    label: monthName + " " + lastDay + " at 12:00 PM Pacific Time",
  };
}
// datetime-local inputs represent MCC wall time, regardless of the device zone.
export function pacificDateTime(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return new Date(NaN);
  const wall = Date.parse(value + ":00Z");
  let instant = wall;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: PAYROLL_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).format(new Date(instant)).replace(" ", "T");
    const correction = wall - Date.parse(parts + "Z");
    if (!correction) return new Date(instant);
    instant += correction;
  }
  return new Date(NaN);
}
