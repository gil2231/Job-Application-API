import { platformScore } from "../detect";
import { FormAdapter } from "../form/form-adapter";

/**
 * Lever postings (jobs.lever.co). The job page links to `/apply`; the form
 * asks for a single full name, labels questions with `.application-label`
 * and a ✱ for required, and parses an uploaded resume into the name, email
 * and company fields, which Applyance then restores from the Master Profile.
 */
export class LeverAdapter extends FormAdapter {
  constructor() {
    super({
      platform: "LEVER",
      displayName: "Lever",
      supportsAutoSubmit: true,
      scan: { roots: ["#application-form", "form.application-form"], groupLabelSelectors: [".application-label"] },
      startButtons: ["a.postings-btn[href$='/apply']", "a[data-qa='show-page-apply']"],
      navigationButtons: ["#btn-submit", "button[data-qa='btn-submit']"],
      uploadSettleMs: 750,
      humanDetail: {
        CAPTCHA: "Lever asked for an hCaptcha check. Applyance never solves CAPTCHAs.",
      },
    });
  }

  override detect(url: string, html?: string): number {
    return platformScore("LEVER", url, html);
  }
}
