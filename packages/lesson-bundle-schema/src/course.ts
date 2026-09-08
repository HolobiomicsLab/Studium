import { z } from "zod";

// COURSE SPINE — the lesson-level layer above a bundle. A course is an ordered/DAG sequence of lessons
// (each a bundle), with optional per-lesson prerequisites. The within-lesson concept graph + adaptive
// router already exist; this is the missing layer that sequences LESSONS and routes the next one off the
// learner's completed-lessons (tracked in the cross-lesson LearnerProfile).

export const CourseLessonSchema = z.object({
  lesson_id: z.string().min(1),  // == the bundle_id this lesson resolves to (the completed-lessons key)
  bundle_ref: z.string().min(1), // how the host loads it (resolveBundle)
  title: z.string().optional(),
  prerequisite_lesson_ids: z.array(z.string()).default([]),
});
export type CourseLesson = z.infer<typeof CourseLessonSchema>;

export const CourseSchema = z.object({
  schema_version: z.literal("1.0"),
  course_id: z.string().min(1),
  title: z.string().min(1),
  lessons: z.array(CourseLessonSchema).min(1),
});
export type Course = z.infer<typeof CourseSchema>;

/** The next lesson the learner should take: the FIRST not-yet-completed lesson whose prerequisites are
 * ALL completed. Handles linear (each prereq = the previous lesson), DAG (explicit prereqs), and
 * no-prereqs (just the next incomplete). Returns null when every lesson is done (course complete) — or
 * when nothing is unlocked (a mis-authored cycle / unmet prereq), so the caller can detect a stuck course. */
export function nextCourseLesson(course: Course, completedLessonIds: readonly string[]): CourseLesson | null {
  const done = new Set(completedLessonIds);
  for (const l of course.lessons) {
    if (done.has(l.lesson_id)) continue;
    if (l.prerequisite_lesson_ids.every((p) => done.has(p))) return l;
  }
  return null;
}

/** True once every lesson in the course is completed. */
export function isCourseComplete(course: Course, completedLessonIds: readonly string[]): boolean {
  const done = new Set(completedLessonIds);
  return course.lessons.every((l) => done.has(l.lesson_id));
}
