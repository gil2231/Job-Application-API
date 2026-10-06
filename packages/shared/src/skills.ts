/**
 * Skill vocabulary used to find skills in job postings and to compare them
 * with the skills in a Master Profile. Each entry is [canonical name, ...aliases].
 * The user's own profile skills are always searched for as well, so this list
 * only has to cover common terms.
 */
const SKILL_ENTRIES: string[][] = [
  // Programming languages
  ["JavaScript", "JS", "ECMAScript"],
  ["TypeScript", "TS"],
  ["Python"],
  ["Java"],
  ["C#", "C Sharp"],
  ["C++", "CPP"],
  ["Go", "Golang"],
  ["Rust"],
  ["Ruby"],
  ["PHP"],
  ["Kotlin"],
  ["Swift"],
  ["Scala"],
  ["R"],
  ["SQL"],
  ["Bash", "Shell scripting"],
  ["HTML", "HTML5"],
  ["CSS", "CSS3"],
  // Frameworks and runtimes
  ["React", "React.js", "ReactJS"],
  ["Next.js", "NextJS"],
  ["Vue", "Vue.js"],
  ["Angular", "AngularJS"],
  ["Svelte"],
  ["Node.js", "Node", "NodeJS"],
  ["Express", "Express.js"],
  ["Django"],
  ["Flask"],
  ["FastAPI"],
  ["Spring", "Spring Boot"],
  ["Ruby on Rails", "Rails"],
  [".NET", "dotnet", "ASP.NET"],
  ["GraphQL"],
  ["REST APIs", "REST", "RESTful APIs", "RESTful"],
  ["Tailwind CSS", "Tailwind"],
  ["React Native"],
  ["Flutter"],
  // Data and ML
  ["PostgreSQL", "Postgres"],
  ["MySQL"],
  ["MongoDB"],
  ["Redis"],
  ["Elasticsearch"],
  ["Snowflake"],
  ["BigQuery"],
  ["Databricks"],
  ["Apache Spark", "Spark", "PySpark"],
  ["Kafka", "Apache Kafka"],
  ["Airflow", "Apache Airflow"],
  ["dbt"],
  ["Pandas"],
  ["NumPy"],
  ["scikit-learn", "sklearn"],
  ["TensorFlow"],
  ["PyTorch"],
  ["Machine Learning", "ML"],
  ["Deep Learning"],
  ["Natural Language Processing", "NLP"],
  ["Large Language Models", "LLMs", "LLM"],
  ["Data Analysis", "Data Analytics"],
  ["Data Visualization"],
  ["Statistics", "Statistical analysis"],
  ["ETL"],
  ["Tableau"],
  ["Power BI", "PowerBI"],
  ["Looker"],
  ["Excel", "Microsoft Excel", "MS Excel"],
  ["Google Sheets"],
  // Infrastructure
  ["AWS", "Amazon Web Services"],
  ["Google Cloud", "GCP", "Google Cloud Platform"],
  ["Azure", "Microsoft Azure"],
  ["Docker"],
  ["Kubernetes", "K8s"],
  ["Terraform"],
  ["CI/CD", "Continuous integration"],
  ["Linux"],
  ["Git", "GitHub", "GitLab"],
  ["Microservices"],
  ["DevOps"],
  ["Observability", "Monitoring"],
  ["Cybersecurity", "Information security", "InfoSec"],
  ["Playwright"],
  ["Selenium"],
  ["Jest"],
  ["Cypress"],
  ["Unit testing", "Test automation"],
  // Product, design and delivery
  ["Agile"],
  ["Scrum"],
  ["Kanban"],
  ["Jira"],
  ["Confluence"],
  ["Asana"],
  ["Product management"],
  ["Project management"],
  ["Program management"],
  ["Roadmapping", "Product roadmap"],
  ["User research", "UX research"],
  ["A/B testing", "AB testing", "Experimentation"],
  ["Figma"],
  ["Sketch"],
  ["Adobe Creative Suite", "Adobe Creative Cloud"],
  ["Photoshop", "Adobe Photoshop"],
  ["Illustrator", "Adobe Illustrator"],
  ["UX design", "User experience"],
  ["UI design", "User interface design"],
  ["Prototyping"],
  ["Wireframing"],
  // Sales
  ["Salesforce", "SFDC", "Salesforce CRM"],
  ["HubSpot"],
  ["Outreach", "Outreach.io"],
  ["Salesloft", "SalesLoft"],
  ["Gong"],
  ["ZoomInfo"],
  ["Apollo", "Apollo.io"],
  ["LinkedIn Sales Navigator", "Sales Navigator"],
  ["CRM", "Customer relationship management"],
  ["Cold calling", "Cold-calling"],
  ["Cold email", "Cold emailing"],
  ["Prospecting"],
  ["Lead generation", "Lead gen"],
  ["Pipeline management", "Pipeline generation"],
  ["Account management"],
  ["Business development"],
  ["B2B sales", "B2B"],
  ["B2C sales", "B2C"],
  ["SaaS sales", "SaaS"],
  ["Enterprise sales"],
  ["Solution selling", "Consultative selling"],
  ["Negotiation"],
  ["Closing", "Deal closing"],
  ["Quota attainment", "Quota-carrying", "Exceeded quota"],
  ["MEDDIC", "MEDDPICC"],
  ["Challenger Sale", "Challenger"],
  ["SPIN Selling"],
  ["Sales forecasting", "Forecasting"],
  ["Customer success"],
  ["Customer service", "Customer support"],
  ["Upselling", "Cross-selling"],
  ["Territory management"],
  ["Demos", "Product demos", "Product demonstrations"],
  ["Discovery calls", "Discovery"],
  // Marketing
  ["SEO", "Search engine optimization"],
  ["SEM", "Search engine marketing", "Paid search"],
  ["Google Analytics", "GA4"],
  ["Google Ads", "AdWords"],
  ["Content marketing"],
  ["Email marketing"],
  ["Social media marketing", "Social media"],
  ["Copywriting"],
  ["Marketing automation"],
  ["Marketo"],
  ["Demand generation", "Demand gen"],
  ["Growth marketing"],
  ["Brand marketing", "Branding"],
  ["Product marketing"],
  ["Public relations", "PR"],
  ["Market research"],
  // Finance and operations
  ["Financial modeling", "Financial modelling"],
  ["Financial analysis"],
  ["Accounting"],
  ["GAAP", "US GAAP"],
  ["FP&A", "Financial planning and analysis"],
  ["Budgeting"],
  ["QuickBooks"],
  ["NetSuite"],
  ["SAP"],
  ["Bookkeeping"],
  ["Auditing", "Audit"],
  ["Operations management"],
  ["Supply chain", "Supply chain management"],
  ["Logistics"],
  ["Procurement"],
  ["Process improvement", "Continuous improvement"],
  ["Lean", "Six Sigma", "Lean Six Sigma"],
  ["Inventory management"],
  ["Vendor management"],
  // People and general
  ["Recruiting", "Talent acquisition"],
  ["Human resources", "HR"],
  ["Payroll"],
  ["Onboarding"],
  ["People management", "Team management", "Team leadership"],
  ["Leadership"],
  ["Coaching", "Mentoring"],
  ["Stakeholder management"],
  ["Communication", "Communication skills", "Written and verbal communication"],
  ["Presentation skills", "Public speaking", "Presentations"],
  ["Problem solving", "Problem-solving"],
  ["Time management"],
  ["Cross-functional collaboration", "Cross-functional"],
  ["Microsoft Office", "MS Office", "Microsoft 365", "Office 365"],
  ["PowerPoint", "Microsoft PowerPoint"],
  ["Word", "Microsoft Word"],
  ["Google Workspace", "G Suite"],
  ["Slack"],
  ["Zendesk"],
  ["Intercom"],
  ["Notion"],
  ["Spanish"],
  ["French"],
  ["German"],
  ["Mandarin", "Chinese"],
  ["Portuguese"],
  ["Japanese"],
  ["Bilingual"],
];

/** Terms too ambiguous to find in free text by themselves (they only match profile skills exactly). */
const AMBIGUOUS_IN_TEXT = new Set(["r", "go", "word", "closing", "discovery", "node", "spark", "audit", "pr", "ts", "js", "ml", "hr", "lean", "challenger", "outreach", "apollo", "gong", "rest", "demos", "b2b", "b2c", "saas", "forecasting", "communication", "leadership", "monitoring", "social media", "chinese", "experimentation", "branding", "onboarding", "budgeting", "accounting", "logistics", "procurement", "statistics", "llm"]);

export interface SkillTerm {
  canonical: string;
  term: string;
  /** Whether the term is specific enough to search for in job text. */
  searchable: boolean;
}

export const SKILL_TERMS: SkillTerm[] = SKILL_ENTRIES.flatMap(([canonical, ...aliases]) =>
  [canonical!, ...aliases].map((term) => ({ canonical: canonical!, term, searchable: !AMBIGUOUS_IN_TEXT.has(term.toLowerCase()) })),
);

const CANONICAL_BY_KEY = new Map<string, string>();
for (const { canonical, term } of SKILL_TERMS) CANONICAL_BY_KEY.set(skillKey(term), canonical);

/** Lowercased, punctuation-light key for comparing skill names. */
export function skillKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/[^a-z0-9+#./&]+/g, " ")
    .trim();
}

/** Map a skill name or alias to its canonical name ("Postgres" → "PostgreSQL"). Unknown names pass through. */
export function canonicalSkill(name: string): string {
  return CANONICAL_BY_KEY.get(skillKey(name)) ?? name.trim();
}

/** Comparison key that treats aliases as the same skill. */
export function canonicalSkillKey(name: string): string {
  return skillKey(canonicalSkill(name));
}
