import { ContextHelp } from "@studium/activity-presentation/react";
import "../../../ui/context-help.css";
import "./globals.css";
import DashboardHeader from "@/components/DashboardHeader";

export const metadata = {
  title: "Studium — Espace enseignant",
  description: "Pilotage pédagogique et lectures de cours",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <a className="skip-link" href="#contenu">
          Aller au contenu
        </a>
        <DashboardHeader />
        <aside style={{ maxWidth: "72rem", margin: "0 auto", padding: "0 1rem" }} aria-label="Comprendre les indicateurs"><ContextHelp topic="mastery" audience="teacher" /></aside>
        {children}
      </body>
    </html>
  );
}
