import { platformScore } from "../detect";
import { FormAdapter } from "../form/form-adapter";

/**
 * Ashby job boards (jobs.ashbyhq.com). A single-page app: the Application tab
 * swaps the form in without a page load, Yes/No questions are pairs of
 * buttons, location is a suggestion box, and submitting replaces the form
 * with a confirmation in place. The "Autofill from resume" upload is skipped
 * so the form is filled from the Master Profile only.
 */
export class AshbyAdapter extends FormAdapter {
  constructor() {
    super({
      platform: "ASHBY",
      displayName: "Ashby",
      supportsAutoSubmit: true,
      scan: {
        roots: [".ashby-application-form-container", "form"],
        groupLabelSelectors: ["label", ".ashby-application-form-question-title"],
        buttonGroups: ["[class*='yesno']"],
        ignore: ["[class*='autofill']"],
      },
      startButtons: ["a[role='tab'][href$='/application']", ".ashby-job-posting-apply-button"],
      navigationButtons: [".ashby-application-form-submit-button"],
      // Ashby's system fields (`_systemfield_email`) and question UUIDs are fixed per job.
      stableIds: /^_systemfield_\w+$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_\w+)?$/i,
    });
  }

  override detect(url: string, html?: string): number {
    return platformScore("ASHBY", url, html);
  }
}
