/**
 * @vitest-environment node
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AILiteracyCard from "../components/AILiteracyCard";
import AutonomyBar from "../components/AutonomyBar";
import BlueprintRadar from "../components/BlueprintRadar";
import CalibrationChart from "../components/CalibrationChart";
import CourseProgress from "../components/CourseProgress";
import JournalStatsCard from "../components/JournalStatsCard";
import ProgressHeatmap from "../components/ProgressHeatmap";
import ReasoningBreakdown from "../components/ReasoningBreakdown";
import TrajectoryChart from "../components/TrajectoryChart";
import TrustCalibrationChart from "../components/TrustCalibrationChart";
import { formatRoomError } from "../components/PeerRoomPanel";
import { formatSubmissionError } from "../components/SubmissionsQueue";
import type {
  AutonomyResponse,
  BlueprintScoreResponse,
  CalibrationResponse,
  ConceptMasteryHistoryResponse,
  CourseCompletionResponse,
  CourseManifest,
  Judgement,
  ReasoningResponse,
  TrustCalibrationResponse,
} from "../lib/api";

const judgement: Judgement = {
  cohort_band: "5–9",
  cohort_counts: "distinct learners within one lesson",
  non_attribution: "class-level reading",
};

const calibration: CalibrationResponse = {
  brier_score: 0,
  n_items: 4,
  judgement,
};

const autonomy: AutonomyResponse = {
  critique_completion_rate: 0.5,
  autonomy_ratio: 0,
  n_critique: 0,
  n_hints: 4,
  judgement,
};

const trust: TrustCalibrationResponse = {
  trust_calibration: 0,
  band: "bien",
  n_audits: 2,
  over_trust: 0,
  over_distrust: null,
  withheld_below_floor: false,
  per_scene: [],
  judgement,
};

const course: CourseManifest = {
  schema_version: "1.0",
  course_id: "course-1",
  title: "Cinétique",
  lessons: [
    {
      lesson_id: "lesson-1",
      bundle_ref: "lesson-1/lesson.json",
      title: "Observer",
      prerequisite_lesson_ids: [],
    },
    {
      lesson_id: "lesson-2",
      bundle_ref: "lesson-2/lesson.json",
      title: "Interpréter",
      prerequisite_lesson_ids: ["lesson-1"],
    },
  ],
};

const completion: CourseCompletionResponse = {
  lessons: { "lesson-1": { n_completed: 0 } },
  total_completions: 0,
};

const reasoning: ReasoningResponse = {
  scenes: {
    "scene-1": {
      score: 0,
      n_signals: 1,
      breakdown: { justification: 0, synthesis: 1 },
      ...judgement,
    },
  },
  withheld_below_floor: false,
  judgement,
};

const trajectory: ConceptMasteryHistoryResponse = {
  concepts: {
    "concept-a": [
      {
        date: "2026-10-01",
        pseudonyme: "learner",
        alpha: 1,
        beta: 1,
        mastery: 0,
        n_attempts: 1,
      },
    ],
    "concept-b": [
      {
        date: "2026-10-02",
        pseudonyme: "learner",
        alpha: 2,
        beta: 1,
        mastery: 0.5,
        n_attempts: 2,
      },
    ],
  },
};

function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("accessible chart alternatives", () => {
  const blueprint: BlueprintScoreResponse = {
    dimensions: [
      { id: "observations", label: "Observations", score: null, degraded: true },
      { id: "reasoning", label: "Raisonnement", score: 0, degraded: false },
    ],
    overall_weighted_score: null,
  };

  const charts: Array<[string, ReactElement]> = [
    [
      "progression",
      createElement(ProgressHeatmap, {
        data: { scenes: { "scene-1": { completion_rate: 0, n_learners: 5 } } },
      }),
    ],
    ["blueprint", createElement(BlueprintRadar, { data: blueprint })],
    ["trajectory", createElement(TrajectoryChart, { data: trajectory })],
    ["reasoning", createElement(ReasoningBreakdown, { data: reasoning })],
    ["calibration", createElement(CalibrationChart, { data: calibration })],
    ["trust", createElement(TrustCalibrationChart, { data: trust })],
    ["autonomy", createElement(AutonomyBar, { data: autonomy })],
    [
      "AI literacy",
      createElement(AILiteracyCard, {
        pseudonyme: "learner",
        data: {
          value: null,
          ic80: null,
          n_sessions: 0,
          window: 10,
          degraded: true,
          components: {
            ai_audit_accuracy: null,
            hint_independence_trend: 0,
            critique_completion_rate: 0.5,
          },
        },
      }),
    ],
    ["course progress", createElement(CourseProgress, { course, completion })],
    [
      "journal",
      createElement(JournalStatsCard, {
        data: {
          entries_total: 0,
          mean_length: 0,
          revision_rate: 0,
          entries_by_scene: { "scene-1": { count: 0, mean_length: 0 } },
        },
      }),
    ],
  ];

  for (const [name, element] of charts) {
    it(`${name} exposes a captioned data table beside the visual`, () => {
      const html = render(element);
      expect(html).toContain("<figure");
      expect(html).toContain("<figcaption");
      expect(html).toContain("<table");
      expect(html).toContain("<caption");
      expect(html).toContain("chart-data-table--visually-hidden");
    });
  }

  it("keeps missing blueprint values distinct from measured zero", () => {
    const html = render(createElement(BlueprintRadar, { data: blueprint }));
    expect(html).toMatch(/Observations[\s\S]*?<td>—<\/td>/);
    expect(html).toMatch(/Raisonnement[\s\S]*?<td>0 %<\/td>/);
  });

  it("keeps a missing trajectory point distinct from measured zero", () => {
    const html = render(createElement(TrajectoryChart, { data: trajectory }));
    expect(html).toMatch(/2026-10-01[\s\S]*?<td>0 %<\/td>[\s\S]*?<td>—<\/td>/);
  });

  it("uses supplied scene and concept titles without changing the raw data keys", () => {
    const progressHtml = render(createElement(ProgressHeatmap, {
      data: { scenes: { "scene-1": { completion_rate: 0.5, n_learners: 5 } } },
      sceneTitles: { "scene-1": "Comparer les modèles" },
    }));
    const reasoningHtml = render(createElement(ReasoningBreakdown, {
      data: reasoning,
      sceneTitles: { "scene-1": "Justifier le choix" },
    }));
    const trajectoryHtml = render(createElement(TrajectoryChart, {
      data: trajectory,
      conceptTitles: { "concept-a": "Énergie d’activation" },
    }));
    const journalHtml = render(createElement(JournalStatsCard, {
      data: {
        entries_total: 1,
        mean_length: 42,
        revision_rate: 0,
        entries_by_scene: { "scene-1": { count: 1, mean_length: 42 } },
      },
      sceneTitles: { "scene-1": "Retour réflexif" },
    }));

    expect(progressHtml).toContain("Comparer les modèles");
    expect(reasoningHtml).toContain("Justifier le choix");
    expect(trajectoryHtml).toContain("Énergie d’activation");
    expect(journalHtml).toContain("Retour réflexif");
  });
});

describe("actionable service errors", () => {
  it("names scene-synth and never repeats an item identifier", () => {
    const message = formatSubmissionError(
      new Error("scene-synth /learner-items/item-secret/decide failed"),
    );
    expect(message).toContain("scene-synth");
    expect(message).toContain("Vérifiez");
    expect(message).not.toContain("item-secret");
  });

  it("names lesson-server and never repeats a teacher key", () => {
    const message = formatRoomError(
      new Error("lesson-server /rooms/r1?teacher_key=teacher-secret failed"),
    );
    expect(message).toContain("lesson-server");
    expect(message).toContain("Vérifiez");
    expect(message).not.toContain("teacher-secret");
  });
});
