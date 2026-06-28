import Link from "next/link";

type Props = {
  token: string;
  active:
    | "progress"
    | "calibration"
    | "trust-calibration"
    | "autonomy"
    | "trajectory"
    | "ai-literacy"
    | "reasoning"
    | "journal"
    | "cooperation"
    | "blueprint"
    | "submissions";
};

const TABS: { key: Props["active"]; label: string }[] = [
  { key: "progress", label: "Progression" },
  { key: "calibration", label: "Calibration" },
  { key: "trust-calibration", label: "Confiance IA" },
  { key: "autonomy", label: "Autonomie" },
  { key: "trajectory", label: "Trajectoire" },
  { key: "ai-literacy", label: "Littératie IA" },
  { key: "reasoning", label: "Raisonnement" },
  { key: "journal", label: "Journal" },
  { key: "cooperation", label: "Coopération" },
  { key: "blueprint", label: "Blueprint" },
  { key: "submissions", label: "Soumissions" },
];

export default function CourseNav({ token, active }: Props) {
  return (
    <nav className="border-b mb-6">
      <ul className="flex gap-4">
        {TABS.map((t) => (
          <li key={t.key}>
            <Link
              href={`/courses/${encodeURIComponent(token)}/${t.key}`}
              className={
                (t.key === active
                  ? "inline-block py-2 border-b-2 border-blue-600 font-semibold"
                  : "inline-block py-2 text-gray-600 hover:text-gray-900") +
                " focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded"
              }
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
