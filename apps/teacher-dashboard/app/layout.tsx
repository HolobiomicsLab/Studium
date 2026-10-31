import { cookies } from "next/headers";
import "../../../ui/context-help.css";
import "./globals.css";
import "./analytics.css";
import "./library.css";
import DashboardHeader from "@/components/DashboardHeader";
import { requestLocale } from "@/lib/request-locale";
import { messages } from "@/lib/i18n";

export const metadata = {
  title: "Studium — Espace enseignant",
  description: "Pilotage pédagogique et lectures de cours",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await requestLocale();
  const t = messages(locale);
  const preference = (await cookies()).get("studium-theme")?.value;
  const theme = preference === "light" || preference === "dark" ? preference : "system";
  return (
    <html lang={locale} data-theme={theme === "system" ? undefined : theme}>
      <body>
        <a className="skip-link" href="#contenu">
          {t.skip}
        </a>
        <DashboardHeader locale={locale} theme={theme} />
        {children}
      </body>
    </html>
  );
}
