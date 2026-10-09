/**
 * Public job boards searched by default, so a search covers well-known
 * employers without the user listing any boards. Every entry is a company's
 * own public board on an ATS that publishes one (see job-boards.ts). A board
 * that has moved or closed is skipped quietly in wide searches. Add companies
 * here as "provider:board" (Workday: "workday:tenant.wdN/Site").
 */
export const DIRECTORY_BOARDS: readonly string[] = [
  // Greenhouse
  ...[
    "airbnb", "stripe", "figma", "robinhood", "coinbase", "discord", "dropbox", "reddit", "pinterest", "lyft",
    "instacart", "gitlab", "datadog", "mongodb", "cloudflare", "elastic", "twilio", "databricks", "okta", "toast",
    "gusto", "brex", "chime", "affirm", "sofi", "squarespace", "asana", "airtable", "samsara", "rubrik",
    "carta", "anthropic", "scaleai", "duolingo", "roblox", "gemini", "webflow", "grammarly", "flexport", "nerdwallet",
    "betterment", "marqeta", "doordashusa", "hubspotjobs", "vercel", "mixpanel", "amplitude", "braze", "intercom", "zscaler",
    "calendly", "point72", "twosigma", "oscar", "peloton", "etsy", "warbyparker", "seatgeek", "compass",
    // Trading, finance and fintech
    "wehrtyou", "towerresearchcapital", "jumptrading", "akunacapital", "imc", "optiverus", "addepar1", "bitgo", "justworks",
    // Tech, media and more
    "thetradedesk", "klaviyo", "zocdoc", "voxmedia", "axios", "yext", "andurilindustries", "spacex", "waymo", "fivetran",
    "lattice", "dataiku", "abnormalsecurity", "verkada", "faire", "pagerduty", "launchdarkly", "sproutsocial", "gleanwork",
  ].map((b) => `greenhouse:${b}`),
  // Lever
  ...["palantir", "spotify", "plaid", "zoox", "wealthsimple", "attentive", "matchgroup", "ro"].map((b) => `lever:${b}`),
  // Ashby
  ...[
    "openai", "ramp", "notion", "linear", "mercury", "deel", "retool", "replit", "perplexity", "supabase",
    "posthog", "harvey", "vanta", "runway", "elevenlabs", "cohere", "snowflake", "anysphere", "kalshi", "writer", "hex", "drata",
  ].map((b) => `ashby:${b}`),
  // Workday
  ...[
    "salesforce.wd12/External_Career_Site", "nvidia.wd5/NVIDIAExternalCareerSite", "adobe.wd5/external_experienced", "walmart.wd5/WalmartExternal",
    "capitalone.wd12/Capital_One", "mastercard.wd1/CorporateCareers", "citi.wd5/2", "accenture.wd103/AccentureCareers", "intel.wd1/External",
    "paypal.wd1/jobs", "dell.wd1/External", "hp.wd5/ExternalCareerSite", "ghr.wd1/Lateral-US", "blackrock.wd1/BlackRock_Professional",
    "statestreet.wd1/Global", "pwc.wd3/Global_Experienced_Careers", "workday.wd5/Workday", "target.wd5/targetcareers", "disney.wd5/disneycareer",
    "comcast.wd5/Comcast_Careers",
  ].map((b) => `workday:${b}`),
  // SmartRecruiters
  ...["Visa", "BoschGroup", "Ubisoft2", "ServiceNow", "Equinix"].map((b) => `smartrecruiters:${b}`),
  // Workable
  "workable:workable",
];
