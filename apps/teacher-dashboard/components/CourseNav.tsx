"use client";

import Link from "next/link";
import { useState } from "react";

type Props = {
  token: string;
  active: CourseDestination;
};

export type CourseDestination =
  | "progress"
  | "course-progress"
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

type NavigationGroup = {
  label: string;
  items: Array<{ key: CourseDestination; label: string }>;
};

const NAVIGATION_GROUPS: NavigationGroup[] = [
  {
    label: "Vue d’ensemble",
    items: [
      { key: "progress", label: "Progression" },
      { key: "course-progress", label: "Parcours" },
    ],
  },
  {
    label: "Apprentissages",
    items: [
      { key: "calibration", label: "Calibration" },
      { key: "trust-calibration", label: "Confiance IA" },
      { key: "autonomy", label: "Critique / indice" },
      { key: "trajectory", label: "Trajectoire" },
    ],
  },
  {
    label: "Pratiques",
    items: [
      { key: "ai-literacy", label: "Littératie IA" },
      { key: "reasoning", label: "Raisonnement" },
      { key: "journal", label: "Journal" },
      { key: "cooperation", label: "Coopération" },
    ],
  },
  {
    label: "Pilotage",
    items: [
      { key: "blueprint", label: "Blueprint" },
      { key: "submissions", label: "Soumissions" },
    ],
  },
];

/** Renders the twelve course destinations as grouped desktop and mobile navigation. */
export default function CourseNav({ token, active }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const activeLabel = NAVIGATION_GROUPS.flatMap((group) => group.items).find(
    (item) => item.key === active,
  )?.label;

  return (
    <div className="course-navigation">
      <button
        type="button"
        className="course-navigation__toggle"
        aria-controls="course-destinations"
        aria-expanded={isOpen}
        aria-label={`Afficher la navigation du cours, vue actuelle : ${activeLabel}`}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span>
          <small>Vue actuelle</small>
          {activeLabel}
        </span>
        <span className="course-navigation__toggle-icon" aria-hidden="true">
          {isOpen ? "−" : "+"}
        </span>
      </button>

      <nav
        id="course-destinations"
        className="course-navigation__panel"
        data-open={isOpen ? "true" : "false"}
        aria-label="Navigation du cours"
      >
        {NAVIGATION_GROUPS.map((group, groupIndex) => {
          const headingId = `course-nav-group-${groupIndex}`;
          return (
            <section className="course-navigation__group" key={group.label} aria-labelledby={headingId}>
              <h2 id={headingId}>{group.label}</h2>
              <ul>
                {group.items.map((item) => (
                  <li key={item.key}>
                    <Link
                      href={`/courses/${encodeURIComponent(token)}/${item.key}`}
                      className="course-navigation__link"
                      aria-current={item.key === active ? "page" : undefined}
                      onClick={() => setIsOpen(false)}
                    >
                      <span aria-hidden="true" className="course-navigation__marker" />
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </nav>
    </div>
  );
}
