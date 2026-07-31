export const bankPeriodPresets = [
  "today",
  "this-week",
  "last-week",
  "this-month",
  "last-month",
  "recent",
  "this-year"
] as const;

export type BankPeriodPreset = (typeof bankPeriodPresets)[number];

export type BankPeriodRange = {
  fromDate: string;
  toDate: string;
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function shiftDate(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function startOfIsoWeek(value: string): string {
  const date = parseIsoDate(value);
  const weekday = date.getUTCDay();
  return shiftDate(value, -(weekday === 0 ? 6 : weekday - 1));
}

export function bankPeriodPresetRange(
  preset: BankPeriodPreset,
  today: string,
  recentDays = 45
): BankPeriodRange {
  const date = parseIsoDate(today);

  if (preset === "today") return { fromDate: today, toDate: today };

  if (preset === "this-week") {
    return { fromDate: startOfIsoWeek(today), toDate: today };
  }

  if (preset === "last-week") {
    const thisWeek = startOfIsoWeek(today);
    return {
      fromDate: shiftDate(thisWeek, -7),
      toDate: shiftDate(thisWeek, -1)
    };
  }

  if (preset === "this-month") {
    date.setUTCDate(1);
    return { fromDate: isoDate(date), toDate: today };
  }

  if (preset === "last-month") {
    date.setUTCDate(1);
    const thisMonth = isoDate(date);
    date.setUTCMonth(date.getUTCMonth() - 1);
    return {
      fromDate: isoDate(date),
      toDate: shiftDate(thisMonth, -1)
    };
  }

  if (preset === "this-year") {
    return { fromDate: `${today.slice(0, 4)}-01-01`, toDate: today };
  }

  return {
    fromDate: shiftDate(today, 1 - Math.max(1, recentDays)),
    toDate: today
  };
}

export function bankPeriodPresetLabel(preset: BankPeriodPreset, recentDays = 45): string {
  if (preset === "today") return "Today";
  if (preset === "this-week") return "This week";
  if (preset === "last-week") return "Last week";
  if (preset === "this-month") return "This month";
  if (preset === "last-month") return "Last month";
  if (preset === "this-year") return "This year";
  return `Recent ${recentDays} days`;
}
