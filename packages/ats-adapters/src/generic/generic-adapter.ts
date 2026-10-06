import { FormAdapter } from "../form/form-adapter";

/**
 * Works on any HTML application form. Used for employer career sites and any
 * ATS without its own adapter.
 */
export class GenericWebFormAdapter extends FormAdapter {
  constructor() {
    super({ platform: "GENERIC", displayName: "Generic web form", supportsAutoSubmit: true });
  }

  override detect(): number {
    return 10;
  }
}
