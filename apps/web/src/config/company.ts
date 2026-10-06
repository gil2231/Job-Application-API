/**
 * Business details used by the Terms of Service, Privacy Policy, help center
 * and support emails. Everything in [brackets] is a placeholder: replace it
 * before launch, and set legalReviewed to true only after a lawyer has
 * reviewed /terms and /privacy.
 */
export const COMPANY = {
  productName: "Applyance",
  /** The registered business that offers the service, e.g. "Applyance LLC". */
  legalName: "[Company legal name]",
  /** Where the business is registered, e.g. "a Delaware limited liability company". */
  entityDescription: "[type of business and state or country of registration]",
  /** Postal address for legal notices. */
  mailingAddress: "[Street address, City, State ZIP, Country]",
  supportEmail: "[support@your-domain.com]",
  privacyEmail: "[privacy@your-domain.com]",
  legalEmail: "[legal@your-domain.com]",
  websiteUrl: "[https://your-domain.com]",
  /** State or country whose law governs the Terms, and where disputes are heard. */
  governingLaw: "[State or country]",
  disputeVenue: "[County and state, or city and country, for court disputes]",
  /** The minimum age to create an account. */
  minimumAge: 18,
  /** One or two sentences for the Terms' billing section. */
  refundPolicy: "[Refund policy, e.g. \"Payments are non-refundable except where the law requires.\"]",
  /** Where account data is hosted, e.g. "the United States". */
  dataHostingRegion: "[country where your servers are hosted]",
  /** How long to keep data after an account is closed, before it is permanently deleted. */
  deletionWindowDays: 30,
  /** How long to keep server backups before they are overwritten. */
  backupRetentionDays: 30,
  /** Shown as "Last updated" on both legal pages. Change it whenever the text changes. */
  legalLastUpdated: "2026-10-06",
  /** False shows a "draft, pending legal review" banner and reviewer notes on /terms and /privacy. */
  legalReviewed: false,
  /**
   * Outside companies that process user data for the service. Keep this in
   * step with what is actually deployed; the Privacy Policy lists it.
   */
  serviceProviders: [
    { name: "[Hosting provider, e.g. Vercel, AWS or Render]", purpose: "Runs the web app, background worker and database" },
    { name: "[File storage provider, e.g. AWS S3 or Cloudflare R2]", purpose: "Stores uploaded and generated documents and application screenshots" },
    { name: "Anthropic", purpose: "AI features, when AI is turned on (reading job postings and resumes, mapping form fields, drafting answers and documents)" },
    { name: "Stripe", purpose: "Payment processing for paid plans" },
    { name: "Google and Microsoft", purpose: "Email and calendar sync, only if you connect an account" },
    { name: "[Email delivery provider, e.g. Postmark or Resend]", purpose: "Sends account and notification emails" },
  ],
} as const;

/** True while a value still holds a [placeholder]. */
export function isPlaceholder(value: string): boolean {
  return value.includes("[");
}
