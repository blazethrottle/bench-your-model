// Calendar helpers. A "day" is the number of whole days since 1970-01-01 (UTC).
const MS_PER_DAY = 86400000;

export function toDay(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof text === 'string' ? text : '');
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), date = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, date));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== date) return null;
  return Math.round(d.getTime() / MS_PER_DAY);
}

export function fromDay(day) {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

// 1970-01-01 was a Thursday (weekday 4, with Sunday as 0).
export function isWeekend(day) {
  const weekday = (((day + 4) % 7) + 7) % 7;
  return weekday === 0 || weekday === 6;
}

// The day that is `count` business days after `day`. The start day itself is never counted.
export function addBusinessDays(day, count) {
  let current = day;
  let left = count;
  while (left > 0) {
    current += 1;
    if (!isWeekend(current)) left -= 1;
  }
  return current;
}
