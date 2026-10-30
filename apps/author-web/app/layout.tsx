import { ContextHelp } from "@studium/activity-presentation/react";
import "../../../ui/context-help.css";
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Studium — Author Studio",
  description: "Create and validate lesson plans with AI assistance",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <header className="author-header">
          <h1>Studium — Author Studio</h1>
        </header>
        <aside className="legacy-banner" role="note"><strong>Version héritée · legacy (M1 demo)</strong><p>Cette démonstration conserve le parcours M1. Pour préparer et relire les cours actuels, utilisez la bibliothèque du tableau de bord enseignant.</p><p lang="en">This demo preserves the M1 workflow. Use the teacher dashboard’s course library to prepare and review current lessons.</p></aside>
        <main className="author-content"><ContextHelp topic="review" audience="teacher" />{children}</main>
      </body>
    </html>
  );
}
