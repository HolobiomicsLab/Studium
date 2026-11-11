import SignInForm from "@/components/SignInForm";
import { messages } from "@/lib/i18n";
import { requestLocale } from "@/lib/request-locale";
import { accessCode, safeNextPath } from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = { searchParams: { next?: string | string[] } };

/** Sign-in page: one field for the dashboard's access code; explains when none is configured. */
export default async function LoginPage({ searchParams }: Props) {
  const locale = await requestLocale();
  const t = messages(locale);
  const next = safeNextPath(Array.isArray(searchParams.next) ? searchParams.next[0] : searchParams.next);
  const configured = accessCode() !== null;
  return (
    <main id="contenu" className="library-shell sign-in-page">
      <p className="eyebrow">{t.signInEyebrow}</p>
      <h1>{t.signInTitle}</h1>
      {configured
        ? (<><p>{t.signInLead}</p><SignInForm next={next} locale={locale} /></>)
        : <p className="approval-note" role="status" data-testid="sign-in-unset">{t.signInUnset}</p>}
    </main>
  );
}
