import Link from "next/link";
import { requestLocale } from "@/lib/request-locale";
import { messages } from "@/lib/i18n";

export default async function LessonNotFound() {
  const t = messages(await requestLocale());
  return <main className="library-shell" id="contenu"><h1>{t.lessonMissing}</h1><p>{t.lessonMissingHelp}</p><Link className="button-link" href="/library">{t.backLibrary}</Link></main>;
}
