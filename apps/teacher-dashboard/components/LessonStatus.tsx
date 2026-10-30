import { messages, type Locale } from "@/lib/i18n";
import type { LessonStatus as Status } from "@/lib/library";

export default function LessonStatus({ status, locale }: { status: Status; locale: Locale }) {
  const t = messages(locale);
  return <span className={`lesson-status lesson-status--${status}`}><span aria-hidden="true">{status === "approved" ? "✓" : status === "checked" ? "◈" : "○"}</span> {t[status]}</span>;
}
