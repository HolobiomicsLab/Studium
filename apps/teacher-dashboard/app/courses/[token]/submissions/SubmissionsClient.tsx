"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SubmissionsQueue, {
  makeDecideAction,
  type DecideAction,
} from "@/components/SubmissionsQueue";
import type { LearnerItemView } from "@/lib/api";
import type { Locale } from "@/lib/i18n";

type Props = { token: string; items: LearnerItemView[]; locale: Locale };

/**
 * Client wrapper for the moderation queue. Builds the decide action (POST -> this
 * dashboard's route handler, which calls scene-synth from the server with the review
 * token; the dashboard's only write path), then
 * optimistically drops the decided item from the visible queue and refreshes
 * the server component so the next `submitted` page-load is authoritative.
 */
export default function SubmissionsClient({ token, items, locale }: Props) {
  const router = useRouter();
  const [visible, setVisible] = useState(items);
  const decide = makeDecideAction(token);

  const onDecide: DecideAction = async (itemId, decision, noteCode, reviewerName) => {
    await decide(itemId, decision, noteCode, reviewerName);
    setVisible((prev) => prev.filter((it) => it.item_id !== itemId));
    router.refresh();
  };

  return <SubmissionsQueue items={visible} onDecide={onDecide} locale={locale} />;
}
