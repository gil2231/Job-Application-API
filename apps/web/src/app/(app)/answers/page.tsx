import type { Metadata } from "next";
import { getAnswerSuggestions, getUserSettings, listAnswers } from "@autoapply/database";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { AnswerLibrary } from "./answer-library";

export const metadata: Metadata = { title: "Answer Library" };

export default async function AnswersPage() {
  const user = await requireUser();
  const [answers, suggestions, settings] = await Promise.all([listAnswers(user.id), getAnswerSuggestions(user.id), getUserSettings(user.id)]);
  return (
    <div className="grid gap-5">
      <PageHeader
        title="Answer Library"
        description="Reusable answers to common application questions. Anything below your confidence threshold, or marked for review, pauses for you before it is submitted."
      />
      <AnswerLibrary answers={answers} suggestions={suggestions} threshold={settings.answerConfidenceThreshold} />
    </div>
  );
}
