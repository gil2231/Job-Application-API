import { redirect } from "next/navigation";

/** Recommendations now live under the search bar on the Jobs page. */
export default function RecommendedPage() {
  redirect("/jobs");
}
