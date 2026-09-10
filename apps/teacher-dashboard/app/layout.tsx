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
        {children}
      </body>
    </html>
  );
}
