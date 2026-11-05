const timeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

export const formatDateTime = (iso: string) => timeFormat.format(new Date(iso));

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function formatRelative(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), "hour");
  return relative.format(Math.round(seconds / 86400), "day");
}
