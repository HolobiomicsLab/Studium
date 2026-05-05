"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import type { PlanResponse, LessonPlan, SceneOutline } from "@/lib/api";

function downloadJson(data: object, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PlanEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [planResp, setPlanResp] = useState<PlanResponse | null>(null);
  const [editedTitle, setEditedTitle] = useState("");
  const [editedScenes, setEditedScenes] = useState<SceneOutline[]>([]);
  const [validated, setValidated] = useState(false);
  const [authorId, setAuthorId] = useState("enseignant");

  useEffect(() => {
    const raw = sessionStorage.getItem("plan_response");
    if (raw) {
      const resp: PlanResponse = JSON.parse(raw);
      setPlanResp(resp);
      setEditedTitle(resp.lesson_plan.title);
      setEditedScenes(resp.lesson_plan.scene_outlines);
    }
  }, [id]);

  if (!planResp) {
    return <p>Chargement du plan…</p>;
  }

  const plan = planResp.lesson_plan;
  const scorePercent = Math.round(planResp.critic_score * 100);

  function handleValidate() {
    if (!planResp) return;
    const approved: LessonPlan = {
      ...planResp.lesson_plan,
      title: editedTitle,
      scene_outlines: editedScenes,
      status: "approved",
      validated_by: authorId,
      critic_score: planResp.critic_score,
      critic_annotations: planResp.critic_annotations,
    };
    downloadJson(approved, `lesson_plan_${approved.id}.json`);
    setValidated(true);
  }

  function updateSceneTitle(idx: number, title: string) {
    setEditedScenes(prev => prev.map((s, i) => i === idx ? { ...s, title } : s));
  }

  return (
    <div>
      <h2>Éditeur de plan</h2>

      {/* Critic score */}
      <div style={{ background: "#f0f7ff", padding: "0.75rem 1rem", borderRadius: 6, marginBottom: "1.5rem" }}>
        <strong>Score critic :</strong> {scorePercent}/100
        {planResp.critic_annotations.length > 0 && (
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
            {planResp.critic_annotations.map((a, i) => <li key={i} style={{ fontSize: "0.9rem" }}>{a}</li>)}
          </ul>
        )}
      </div>

      {/* Title */}
      <label style={{ display: "block", marginBottom: "1rem" }}>
        <strong>Titre du cours</strong>
        <input value={editedTitle} onChange={e => setEditedTitle(e.target.value)}
          style={{ display: "block", marginTop: 4, padding: "4px 8px", width: "100%", maxWidth: 500 }} />
      </label>

      {/* Metadata */}
      <p style={{ color: "#666", fontSize: "0.9rem" }}>
        Niveau : {plan.target} · Durée : {plan.duration_minutes} min · Statut : {plan.status}
      </p>

      {/* Objectives */}
      <h3>Objectifs pédagogiques</h3>
      <ul>
        {plan.learning_objectives.map(o => (
          <li key={o.id}><em>{o.bloom_level}</em> — {o.description}</li>
        ))}
      </ul>

      {/* Scenes */}
      <h3>Scènes</h3>
      {editedScenes.map((scene, idx) => (
        <div key={scene.id} style={{ border: "1px solid #ddd", borderRadius: 4, padding: "0.75rem", marginBottom: "0.5rem" }}>
          <span style={{ fontSize: "0.8rem", background: "#eee", padding: "2px 6px", borderRadius: 3 }}>{scene.type}</span>
          <input value={scene.title} onChange={e => updateSceneTitle(idx, e.target.value)}
            style={{ marginLeft: 8, padding: "2px 6px", width: "60%" }} />
          {scene.duration_minutes && <span style={{ marginLeft: 8, fontSize: "0.85rem", color: "#888" }}>{scene.duration_minutes} min</span>}
        </div>
      ))}

      {/* Corpus refs */}
      {plan.corpus_refs.length > 0 && (
        <>
          <h3>Références corpus ({plan.corpus_refs.length})</h3>
          <ul style={{ fontSize: "0.85rem" }}>
            {plan.corpus_refs.map(r => (
              <li key={r.ref_id}>
                [{r.ref_type}] {r.doi || r.ref_id} {r.title ? `— ${r.title}` : ""} {r.resolved ? "✓" : "(offline)"}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Validation */}
      {!validated ? (
        <div style={{ marginTop: "2rem" }}>
          <label style={{ marginRight: 8 }}>
            Identifiant enseignant :
            <input value={authorId} onChange={e => setAuthorId(e.target.value)}
              style={{ marginLeft: 8, padding: "4px 8px" }} />
          </label>
          <button onClick={handleValidate}
            style={{ padding: "8px 16px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
            Valider et exporter
          </button>
          <p style={{ fontSize: "0.85rem", color: "#555", marginTop: 8 }}>
            En validant, vous approuvez ce plan et téléchargez <code>lesson_plan_{plan.id}.json</code> (status=approved).
          </p>
        </div>
      ) : (
        <p style={{ marginTop: "2rem", color: "#16a34a", fontWeight: "bold" }}>
          Plan validé et exporté. Le fichier JSON a été téléchargé.
        </p>
      )}
    </div>
  );
}
