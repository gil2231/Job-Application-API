import { platformScore } from "../detect";
import { FormAdapter } from "../form/form-adapter";

/**
 * SmartRecruiters (jobs.smartrecruiters.com). "I'm interested" opens the
 * one-click application, whose fields are web components with their inputs
 * inside shadow roots. It asks for the email twice and offers to apply with
 * LinkedIn or Indeed, which AutoApply never uses.
 */
export class SmartRecruitersAdapter extends FormAdapter {
  constructor() {
    super({
      platform: "SMARTRECRUITERS",
      displayName: "SmartRecruiters",
      supportsAutoSubmit: true,
      scan: { roots: ["oc-application-form", "[data-test='application-form']"] },
      startButtons: ["[data-test='footer-apply']", "[data-test='apply-button']"],
      navigationButtons: ["[data-test='footer-submit']", "[data-test='footer-next']"],
    });
  }

  override detect(url: string, html?: string): number {
    return platformScore("SMARTRECRUITERS", url, html);
  }
}
