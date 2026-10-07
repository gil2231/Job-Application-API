import type { Page } from "playwright-core";
import { platformScore } from "../detect";
import { FormAdapter } from "../form/form-adapter";

/**
 * Workday (*.myworkdayjobs.com). Apply opens a choice of how to apply;
 * AutoApply always picks Apply Manually (never "Autofill with Resume" or
 * "Use My Last Application"). Workday then asks for a candidate account on
 * each employer's site, which only the person can create or sign in to; their
 * saved session is reused afterwards. The application is a series of steps
 * (My Information, My Experience, Application Questions, Voluntary
 * Disclosures, Review) with "Save and Continue", dropdowns that are buttons
 * opening a list, and a final Review step with only a Submit button.
 */
export class WorkdayAdapter extends FormAdapter {
  constructor() {
    super({
      platform: "WORKDAY",
      displayName: "Workday",
      supportsAutoSubmit: true,
      scan: { roots: ["[data-automation-id='applyFlowPage']"], rootRequired: true },
      startButtons: ["[data-automation-id='adventureButton']", "[data-automation-id='applyManually']"],
      navigationButtons: ["[data-automation-id='bottom-navigation-next-button']", "[data-automation-id='pageFooterNextButton']"],
      humanDetail: {
        AUTH_REQUIRED:
          "Workday asks for a candidate account on each employer's site. Sign in, or create the account yourself; Applyance never creates accounts or enters passwords. Your session is saved, so later applications to this employer continue on their own.",
      },
    });
  }

  override detect(url: string, html?: string): number {
    return platformScore("WORKDAY", url, html);
  }

  protected override async isReviewPage(page: Page): Promise<boolean> {
    return (await page.locator("[data-automation-id='reviewJobApplicationPage']").count()) > 0;
  }
}
