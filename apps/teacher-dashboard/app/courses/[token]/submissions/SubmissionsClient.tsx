"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SubmissionsQueue, {
  makeDecideAction,
  type DecideAction,
} from "@/components/SubmissionsQueue";
import type { LearnerItemView } from "@/lib/api";

type Props = { token: string; items: LearnerItemView[] };

/**
 * Client wrapper for the moderation queue. Builds the course-token-derived
 * decide action (POST -> scene-synth, the dashboard's only write path), then
 * optimistically drops the decided item from the visible queue and refreshes
 * the server component so the next `submitted` page-load is authoritative.
 */
export default function SubmissionsClient({ token, items }: Props) {
  const router = useRouter();
  const [visible, setVisible] = useState(items);
  const decide = makeDecideAction(token);

  const onDecide: DecideAction = async (itemId, decision, noteCode) => {
    await decide(itemId, decision, noteCode);
    setVisible((prev) => prev.filter((it) => it.item_id !== itemId));
    router.refresh();
  };

  return <SubmissionsQueue items={visible} onDecide={onDecide} />;
}
