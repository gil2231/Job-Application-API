import { platformScore } from "../detect";
import { FormAdapter } from "../form/form-adapter";

/**
 * Greenhouse job boards (boards.greenhouse.io, job-boards.greenhouse.io and
 * embedded boards). The form sits under the job description as
 * `#application_form`; newer boards use typeahead dropdowns for questions,
 * location and the EEOC section, and hide the resume input behind "Attach".
 */
export class GreenhouseAdapter extends FormAdapter {
  constructor() {
    super({
      platform: "GREENHOUSE",
      displayName: "Greenhouse",
      supportsAutoSubmit: true,
      scan: { roots: ["#application_form", "#application-form", "form#application"] },
      startButtons: ["#apply_button", "button[aria-label='Apply']", "a[href='#app']"],
      navigationButtons: ["#submit_app", "button[type='submit'][data-source='greenhouse']"],
      humanDetail: {
        CAPTCHA: "Greenhouse showed a CAPTCHA for this employer. Applyance never solves CAPTCHAs.",
      },
    });
  }

  override detect(url: string, html?: string): number {
    return platformScore("GREENHOUSE", url, html);
  }
}
