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

/** Names an upstream read failure and keeps the original error available to the teacher. */
export function ApiError({ message }: { message: string }) {
  return (
    <DashboardNotice title="Erreur API" tone="error" role="alert">
      <p>{message}</p>
    </DashboardNotice>
  );
}
