import type { ReactNode } from "react";

type Props = {
  title: string;
  children: ReactNode;
  tone?: "neutral" | "caution" | "error";
  role?: "alert" | "note";
};

/** Displays contextual guidance without making missing information look numeric. */
export default function DashboardNotice({
  title,
  children,
  tone = "neutral",
  role = "note",
}: Props) {
  return (
    <section className={`notice notice--${tone}`} role={role}>
      <div className="notice__body">
        <h3>{title}</h3>
        {children}
      </div>
    </section>
  );
}

/** The API wrapper supplies a service name and a concrete recovery action. */
export function ApiError({ message }: { message: string }) {
  return (
    <DashboardNotice title="Lecture du service interrompue" tone="error" role="alert">
      <p>{message}</p>
    </DashboardNotice>
  );
}
