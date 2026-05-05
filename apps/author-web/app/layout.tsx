import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Studium — Author Studio",
  description: "Create and validate lesson plans with AI assistance",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 900, margin: "0 auto", padding: "1rem" }}>
        <header style={{ borderBottom: "1px solid #ddd", marginBottom: "1.5rem", paddingBottom: "0.75rem" }}>
          <h1 style={{ margin: 0, fontSize: "1.4rem" }}>Studium — Author Studio</h1>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
