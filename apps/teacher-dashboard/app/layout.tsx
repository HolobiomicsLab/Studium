export const metadata = {
  title: "Studium — Teacher Dashboard",
  description: "Read-only progress dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
