export type ScheduleType = 'once' | 'interval' | 'daily' | 'weekly' | 'monthly';

export type ScheduleResolution = {
  target: Date;
  waitMs: number;
  label: string;
  summary: string;
};

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type IntervalUnit = 'seconds' | 'minutes' | 'hours';

function normalizeIntervalUnit(raw?: string): IntervalUnit {
  if (raw === 'seconds' || raw === 'hours') return raw;
  return 'minutes';
}

function intervalUnitMs(unit: IntervalUnit): number {
  if (unit === 'seconds') return 1_000;
  if (unit === 'hours') return 3_600_000;
  return 60_000;
}

function intervalUnitLabel(unit: IntervalUnit, value: number): string {
  const singular = unit === 'seconds' ? 'second' : unit === 'hours' ? 'hour' : 'minute';
  return value === 1 ? singular : `${singular}s`;
}

export function normalizeScheduleType(raw?: string): ScheduleType {
  if (raw === 'interval' || raw === 'daily' || raw === 'weekly' || raw === 'monthly') {
    return raw;
  }
  return 'once';
}

export function defaultTimeOfDay(): string {
  return '17:00';
}

function parseTimeOfDay(raw: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours > 23 || minutes > 59) {
    return null;
  }

  return { hours, minutes };
}

function setTimeOnDate(base: Date, hours: number, minutes: number): Date {
  const next = new Date(base);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatTime(hours: number, minutes: number): string {
  const stamp = new Date();
  stamp.setHours(hours, minutes, 0, 0);
  return stamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function clampDayInMonth(year: number, month: number, day: number, hours: number, minutes: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  const safeDay = Math.min(Math.max(1, day), lastDay);
  return setTimeOnDate(new Date(year, month, safeDay), hours, minutes);
}

function nextWeekly(dayOfWeek: number, hours: number, minutes: number, now: Date): Date {
  let daysUntil = (dayOfWeek - now.getDay() + 7) % 7;
  const candidate = setTimeOnDate(new Date(now), hours, minutes);
  if (daysUntil === 0 && candidate.getTime() <= now.getTime()) {
    daysUntil = 7;
  }
  return addDays(candidate, daysUntil);
}

function nextMonthly(dayOfMonth: number, hours: number, minutes: number, now: Date): Date {
  let year = now.getFullYear();
  let month = now.getMonth();
  let target = clampDayInMonth(year, month, dayOfMonth, hours, minutes);

  if (target.getTime() <= now.getTime()) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    target = clampDayInMonth(year, month, dayOfMonth, hours, minutes);
  }

  return target;
}

export function describeSchedule(params: Record<string, string>): string {
  const scheduleType = normalizeScheduleType(params.scheduleType);

  if (scheduleType === 'once') {
    const scheduledAt = params.scheduledAt?.trim();
    if (!scheduledAt) return 'Set run time';
    const target = new Date(scheduledAt);
    return Number.isNaN(target.getTime()) ? 'Invalid run time' : target.toLocaleString();
  }

  if (scheduleType === 'interval') {
    const value = Number.parseInt(params.intervalValue?.trim() || '5', 10);
    const unit = normalizeIntervalUnit(params.intervalUnit);
    if (Number.isNaN(value) || value <= 0) return 'Set interval';
    return `Every ${value} ${intervalUnitLabel(unit, value)}`;
  }

  const time = parseTimeOfDay(params.timeOfDay || defaultTimeOfDay());
  const timeLabel = time ? formatTime(time.hours, time.minutes) : 'Set time';

  if (scheduleType === 'daily') {
    return `Daily at ${timeLabel}`;
  }

  if (scheduleType === 'weekly') {
    const day = Number.parseInt(params.weeklyDay ?? '1', 10);
    const dayLabel = WEEKDAY_LABELS[day] ?? 'Set day';
    return `Every ${dayLabel} at ${timeLabel}`;
  }

  const monthlyDay = Number.parseInt(params.monthlyDay?.trim() || '1', 10);
  return `Monthly on day ${monthlyDay} at ${timeLabel}`;
}

export function resolveNextScheduleRun(
  params: Record<string, string>,
  now = new Date(),
): ScheduleResolution | { error: string } {
  const scheduleType = normalizeScheduleType(params.scheduleType);

  if (scheduleType === 'once') {
    const scheduledAt = params.scheduledAt?.trim();
    if (!scheduledAt) {
      return { error: 'Run At time is required' };
    }

    const target = new Date(scheduledAt);
    if (Number.isNaN(target.getTime())) {
      return { error: `Invalid date/time: "${scheduledAt}"` };
    }

    return {
      target,
      waitMs: Math.max(0, target.getTime() - now.getTime()),
      label: target.toLocaleString(),
      summary: describeSchedule(params),
    };
  }

  if (scheduleType === 'interval') {
    const value = Number.parseInt(params.intervalValue?.trim() || '', 10);
    const unit = normalizeIntervalUnit(params.intervalUnit);

    if (Number.isNaN(value) || value <= 0) {
      return { error: 'Interval must be a positive number' };
    }

    const unitMs = intervalUnitMs(unit);
    const target = new Date(now.getTime() + value * unitMs);

    return {
      target,
      waitMs: value * unitMs,
      label: target.toLocaleString(),
      summary: describeSchedule(params),
    };
  }

  const time = parseTimeOfDay(params.timeOfDay || defaultTimeOfDay());
  if (!time) {
    return { error: 'Time of day must use HH:MM format' };
  }

  if (scheduleType === 'daily') {
    let target = setTimeOnDate(new Date(now), time.hours, time.minutes);
    if (target.getTime() <= now.getTime()) {
      target = addDays(target, 1);
    }

    return {
      target,
      waitMs: Math.max(0, target.getTime() - now.getTime()),
      label: target.toLocaleString(),
      summary: describeSchedule(params),
    };
  }

  if (scheduleType === 'weekly') {
    const day = Number.parseInt(params.weeklyDay ?? '', 10);
    if (Number.isNaN(day) || day < 0 || day > 6) {
      return { error: 'Weekly day must be between Sunday (0) and Saturday (6)' };
    }

    const target = nextWeekly(day, time.hours, time.minutes, now);

    return {
      target,
      waitMs: Math.max(0, target.getTime() - now.getTime()),
      label: target.toLocaleString(),
      summary: describeSchedule(params),
    };
  }

  const monthlyDay = Number.parseInt(params.monthlyDay?.trim() || '', 10);
  if (Number.isNaN(monthlyDay) || monthlyDay < 1 || monthlyDay > 31) {
    return { error: 'Monthly day must be between 1 and 31' };
  }

  const target = nextMonthly(monthlyDay, time.hours, time.minutes, now);

  return {
    target,
    waitMs: Math.max(0, target.getTime() - now.getTime()),
    label: target.toLocaleString(),
    summary: describeSchedule(params),
  };
}
