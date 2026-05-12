import { redirect } from "next/navigation";

async function go(formData: FormData) {
  "use server";
  const token = String(formData.get("courseToken") ?? "").trim();
  if (!token) return;
  redirect(`/courses/${encodeURIComponent(token)}/progress`);
}

export default function Home() {
  return (
    <main className="max-w-xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-2">Studium — Teacher Dashboard</h1>
      <p className="text-gray-600 mb-6">
        Tableau de bord en lecture seule. Saisissez le token de cours pour
        consulter les indicateurs de progression, calibration et autonomie.
      </p>
      <form action={go} className="flex gap-2">
        <input
          name="courseToken"
          required
          aria-label="Token du cours"
          placeholder="ex. metabolomics-2026-spring"
          className="flex-1 border rounded px-3 py-2"
        />
        <button
          type="submit"
          className="rounded bg-blue-600 text-white px-4 py-2 hover:bg-blue-700"
        >
          Ouvrir
        </button>
      </form>
      <p className="mt-4 text-xs text-gray-500">
        Itération courante : le token doit correspondre à l&apos;identifiant du cours.
      </p>
    </main>
  );
}
