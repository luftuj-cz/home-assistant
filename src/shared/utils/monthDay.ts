/** Leap-year basis, like the backend's season maths, so 29 February is always a valid boundary. */
export const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const YEAR_DAYS = 366;

/** "MM-DD" → day of the (leap) year, 0-based. */
export function dayOfYear(monthDay: string) {
  const [month, day] = monthDay.split("-").map(Number);
  return MONTH_DAYS.slice(0, month - 1).reduce((sum, days) => sum + days, 0) + day - 1;
}

/** Day of the (leap) year → "MM-DD"; wraps. */
export function monthDayOf(dayIndex: number) {
  let day = ((dayIndex % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
  let month = 0;
  while (day >= MONTH_DAYS[month]) {
    day -= MONTH_DAYS[month];
    month++;
  }
  return `${String(month + 1).padStart(2, "0")}-${String(day + 1).padStart(2, "0")}`;
}

export function todayMonthDay(now = new Date()) {
  return `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** "21. 12." in Czech, "12/21" in English. */
export function formatMonthDay(monthDay: string, language: string) {
  const [month, day] = monthDay.split("-").map(Number);
  return new Date(2024, month - 1, day).toLocaleDateString(language, {
    day: "numeric",
    month: "numeric",
  });
}

/** First letter of each month's name: L Ú B D K Č Č S Z Ř L P in Czech. */
export function monthInitials(language: string) {
  const format = new Intl.DateTimeFormat(language, { month: "long" });
  return MONTH_DAYS.map((_, month) =>
    format
      .format(new Date(2024, month, 1))
      .charAt(0)
      .toUpperCase(),
  );
}

/** Month names for a picker, January first. */
export function monthNames(language: string) {
  const format = new Intl.DateTimeFormat(language, { month: "long" });
  return MONTH_DAYS.map((_, month) => format.format(new Date(2024, month, 1)));
}
