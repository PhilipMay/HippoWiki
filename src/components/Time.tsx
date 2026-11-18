import { formatDateTime } from "@/lib/format";

/** A point in time as a `<time>` element: the ISO value for machines, the text of `formatDateTime()` for people. */
export default function Time({ date }: { date: Date }) {
  return <time dateTime={date.toISOString()}>{formatDateTime(date)}</time>;
}
