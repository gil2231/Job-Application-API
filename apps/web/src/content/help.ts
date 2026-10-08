import { COMPANY } from "@/config/company";

const P = COMPANY.productName;

export type HelpBlock = { p: string } | { steps: string[] } | { list: string[] } | { tip: string } | { h: string };

export interface HelpArticle {
  slug: string;
  title: string;
  summary: string;
  category: HelpCategory;
  /** Extra words people might search for that aren't in the text. */
  keywords?: string[];
  blocks: HelpBlock[];
  /** Pages in the app this article is about, shown as buttons for signed-in readers. */
  links?: Array<{ href: string; label: string }>;
}

export const HELP_CATEGORIES = ["Getting started", "Finding jobs", "Applying", "Tracking", "Account and privacy", "Plans and billing"] as const;
export type HelpCategory = (typeof HELP_CATEGORIES)[number];

export const HELP_ARTICLES: HelpArticle[] = [
  // ── Getting started ──────────────────────────────────────────────────────
  {
    slug: "how-it-works",
    title: `How ${P} works`,
    summary: "Save jobs, let them be scored against your profile, and choose how much is done for you.",
    category: "Getting started",
    keywords: ["overview", "intro", "start", "basics"],
    blocks: [
      { p: `${P} takes the jobs you save, scores each one against your Master Profile, fills in applications on the employer's own careers site from your information, and tracks every application through to an offer.` },
      { steps: [
        "Fill in your Master Profile, or import it from your resume.",
        "Upload your resume and other documents, and save answers to common questions in the Answer Library.",
        "Add jobs: import your LinkedIn saved jobs, paste links, search company job boards, or add one by hand.",
        "Choose Apply on the jobs you want, and pick Manual, Review or Auto.",
        "Handle anything in Needs Attention, such as a CAPTCHA or a question only you can answer.",
        "Follow each application on Flightpath and record interviews and outcomes.",
      ] },
      { tip: `${P} never gets around CAPTCHAs or sign-in checks and never invents qualifications. When a person is needed, it stops and asks you.` },
    ],
    links: [{ href: "/dashboard", label: "Open the dashboard" }],
  },
  {
    slug: "master-profile",
    title: "Set up your Master Profile",
    summary: "Everything an application asks for comes from here, so a complete profile means fewer questions later.",
    category: "Getting started",
    keywords: ["resume import", "work history", "education", "skills", "contact"],
    blocks: [
      { p: "Your Master Profile holds your contact details, links, target job titles, skills, work history and education. Every application is filled from it, and nothing outside it is ever made up." },
      { h: "Start from your resume" },
      { steps: [
        "Open Master Profile and choose Import from resume.",
        "Pick your resume file (PDF, Word .docx or plain text).",
        "Check what was read. Untick anything you don't want, and fix anything that's wrong.",
        "Confirm. Nothing is saved until you do.",
      ] },
      { tip: "Scanned PDFs (pictures of pages) can't be read. Use the original file, or fill in the profile by hand." },
      { h: "Keep it current" },
      { p: "Add each job and school as its own entry, with dates. Match scores use your skills, titles and years of experience, so a fuller profile also gives better recommendations." },
    ],
    links: [{ href: "/profile", label: "Open Master Profile" }],
  },
  {
    slug: "answer-library",
    title: "Save answers to common questions",
    summary: "Answer salary, work authorization and other recurring questions once.",
    category: "Getting started",
    keywords: ["salary", "sponsorship", "visa", "work authorization", "demographic", "eeo", "questions"],
    blocks: [
      { p: "Applications ask the same questions again and again: Are you authorized to work here? Will you need sponsorship? What are your salary expectations? Save your answers in the Answer Library and they're reused everywhere." },
      { list: [
        "Confidence: how sure you are an answer fits every employer. Answers below your threshold in Settings pause for you.",
        "Always ask me to review: the answer is suggested but never used without your approval.",
        "Allow automatic submission: lets Auto mode use the answer without asking.",
      ] },
      { p: "Voluntary demographic answers (gender, race or ethnicity, veteran and disability status) are optional, are only used exactly as you saved them, and are stored with extra encryption. Leave them blank to answer each time, or to decline." },
      { tip: "When an application asks something new, Needs Attention offers to remember your answer for next time." },
    ],
    links: [{ href: "/answers", label: "Open Answer Library" }],
  },
  {
    slug: "documents",
    title: "Upload and tailor resumes and cover letters",
    summary: "Keep several resumes, and let AI tailor one for a specific job for you to approve.",
    category: "Getting started",
    keywords: ["resume", "cv", "cover letter", "upload", "tailor", "pdf"],
    blocks: [
      { p: "Documents holds the resumes, cover letters, certifications, transcripts and portfolio files used in your applications. Mark one resume as your default." },
      { p: "On a job's page you can generate a tailored resume and cover letter for that job. Drafts are built from your Master Profile only, anything that can't be backed up by your profile is flagged, and nothing is used until you approve it. You can edit a draft before approving." },
    ],
    links: [{ href: "/documents", label: "Open Documents" }],
  },

  // ── Finding jobs ─────────────────────────────────────────────────────────
  {
    slug: "linkedin-saved-jobs",
    title: "Import your LinkedIn saved jobs",
    summary: "Bring in jobs you saved on LinkedIn using LinkedIn's own data export.",
    category: "Finding jobs",
    keywords: ["linkedin", "export", "csv", "zip", "import"],
    blocks: [
      { steps: [
        "On LinkedIn, open Settings & Privacy, then Data privacy, then Get a copy of your data.",
        "Choose \"Want something in particular?\", tick Jobs, and request the archive.",
        "When LinkedIn emails you, download the archive.",
        `In ${P}, open Jobs, choose Import, and upload the archive (or the Saved Jobs.csv inside it).`,
      ] },
      { p: `You can also paste job links on the same screen. Any spreadsheet with a job URL column works too.` },
      { tip: `${P} never signs in to LinkedIn, reads LinkedIn pages, or uses Easy Apply, because LinkedIn's terms don't allow automation. Apply to Easy Apply jobs on LinkedIn yourself, then track them here.` },
    ],
    links: [{ href: "/jobs", label: "Open Jobs" }],
  },
  {
    slug: "search-job-boards",
    title: "Search for jobs and set your preferences",
    summary: "Search company job boards everywhere at once, and get jobs recommended from one box of preferences.",
    category: "Finding jobs",
    keywords: ["search", "keyword", "greenhouse", "lever", "ashby", "workday", "workable", "smartrecruiters", "linkedin", "indeed", "boards", "preferences", "recommended"],
    blocks: [
      { p: "The search bar at the top of Jobs searches the public job boards of hundreds of companies on Greenhouse, Lever, Ashby, Workday, Workable, SmartRecruiters and Recruitee at once. When your Applyance has a JSearch key, it also includes listings from LinkedIn, Indeed and other sites. A job found in several places is listed once." },
      { p: "Under the search bar, Recommended for you lists jobs that fit your preferences: one box of roles, industries, keywords and places separated by commas (for example Account Executive, SaaS, FinTech, NYC). Edit it whenever what you want changes." },
      { steps: [
        "Open Jobs and type a job title or keywords in the search bar, with a place if you like.",
        "Use quotes for exact phrases, and a minus sign to leave jobs out (for example -commission).",
        "Pick the results to add. They're scored like any other job.",
        "To search particular companies' boards, choose Search specific boards and paste their board links.",
      ] },
    ],
    links: [{ href: "/jobs", label: "Open Jobs" }],
  },
  {
    slug: "match-scores-and-rules",
    title: "Match scores, rules and recommendations",
    summary: "How jobs are scored, how to decide which ones qualify, and how recommendations work.",
    category: "Finding jobs",
    keywords: ["score", "match", "qualified", "not qualified", "rules", "keywords", "recommended", "filter"],
    blocks: [
      { p: "Each job gets a match score from 0 to 100 based on how well its requirements fit your skills, titles, experience, location and salary. On Rules you choose how much each part counts and the minimum score a job needs to qualify." },
      { p: "Rules can also exclude companies, industries or keywords (for example \"commission-only\"), require certain keywords, set a minimum salary and limit how many applications go out per day." },
      { p: "Recommended for you, on the Jobs page, shows jobs that mention the roles and keywords in your preferences, ranked by how many they mention, how well they match, and whether they're in a place you listed." },
      { tip: "A job saved without a description can't be scored. Open it and add the description, then restart the analysis." },
    ],
    links: [{ href: "/rules", label: "Open Rules" }, { href: "/jobs", label: "Open Jobs" }],
  },

  // ── Applying ─────────────────────────────────────────────────────────────
  {
    slug: "manual-review-auto",
    title: "Manual, Review and Auto modes",
    summary: "Choose whether you click Submit, approve first, or let safe applications go automatically.",
    category: "Applying",
    keywords: ["mode", "submit", "automatic", "approve", "auto-submit"],
    blocks: [
      { list: [
        `Manual: ${P} fills in the application and you click Submit yourself.`,
        `Review: ${P} fills it in and waits. You check it and approve before it's sent.`,
        "Auto: the application is submitted when every safety check passes. Anything uncertain still pauses for you.",
      ] },
      { p: "Auto is off until you turn on auto-submit in Rules. Until then, Auto choices are handled as Review. We recommend starting with Review for your first applications." },
    ],
    links: [{ href: "/rules", label: "Open Rules" }],
  },
  {
    slug: "needs-attention",
    title: "When an application needs you",
    summary: "CAPTCHAs, sign-ins and uncertain answers pause an application until you step in.",
    category: "Applying",
    keywords: ["captcha", "mfa", "two-factor", "sign in", "login", "paused", "stuck", "blocked", "verification"],
    blocks: [
      { p: `${P} stops and asks you whenever a person is needed. Paused applications appear in Needs Attention, with a count in the sidebar.` },
      { list: [
        "CAPTCHA: open Solve CAPTCHAs in the menu. Each paused application shows its real page live there; solve the check in that window and the application carries on by itself. You can also open the application, complete it yourself, then choose I've completed it.",
        "Sign-in or two-factor code: open the site and sign in. Your sign-in is remembered for that site, so you won't be asked every time.",
        "Question it isn't sure about: check or edit the suggested answer, and tick Remember this answer to reuse it.",
        "Final review: look over the filled application and choose Approve & submit.",
      ] },
      { p: "Once you finish, the application picks up where it left off." },
    ],
    links: [{ href: "/needs-attention", label: "Open Needs Attention" }],
  },
  {
    slug: "failed-applications",
    title: "An application failed or didn't submit",
    summary: "What the failure reasons mean and what to try.",
    category: "Applying",
    keywords: ["failed", "error", "timeout", "unsupported", "retry", "site changed", "didn't work"],
    blocks: [
      { list: [
        "Timeout or network error: the employer's site was slow or down. Choose Try again later.",
        "Site changed or unknown field: the form didn't look the way we expected. Open the application and finish it yourself.",
        "Validation error: the site rejected an answer. Check the answer it named, fix it, and try again.",
        "Unsupported site: we can't fill this site automatically yet. Use the link to apply yourself, then choose I submitted it.",
      ] },
      { p: "Each application page shows its timeline and screenshots of what was filled in, which helps you see exactly where it stopped." },
      { tip: "If an application keeps failing, use Report a problem on its page. We'll see which application you mean." },
    ],
    links: [{ href: "/applications", label: "Open Applications" }],
  },
  {
    slug: "ai",
    title: "How AI is used, and turning it off",
    summary: "What the AI does, what it can see, and how to switch it off.",
    category: "Applying",
    keywords: ["ai", "artificial intelligence", "anthropic", "claude", "drafts", "privacy"],
    blocks: [
      { p: "When AI is on, it reads job postings, recognizes form fields the built-in rules don't, drafts answers, and tailors resumes and cover letters. It's only given what each task needs." },
      { list: [
        "Everything it writes is checked against your Master Profile.",
        "It never guesses facts about you, such as legal status, demographics or salary.",
        "Nothing it drafts is sent to an employer without your approval.",
      ] },
      { p: "You can turn AI off in Settings. The built-in rules then do the work, and nothing is sent to an AI provider." },
    ],
    links: [{ href: "/settings", label: "Open Settings" }],
  },

  // ── Tracking ─────────────────────────────────────────────────────────────
  {
    slug: "flightpath",
    title: "Track applications on Flightpath",
    summary: "Move applications from Submitted through interviews to an offer.",
    category: "Tracking",
    keywords: ["tracker", "pipeline", "kanban", "board", "interview", "offer", "rejected", "stage"],
    blocks: [
      { p: "Flightpath shows every application from the queue to an offer. Drag a card to another stage, or use its menu. Stages after Submitted are yours to set." },
      { p: "Open an application to add interview rounds, notes (for example \"recruiter called\") and the outcome." },
      { p: "If you connect your email and calendar, interview invitations and rejections can move applications for you." },
    ],
    links: [{ href: "/flightpath", label: "Open Flightpath" }],
  },

  // ── Account and privacy ──────────────────────────────────────────────────
  {
    slug: "account-security",
    title: "Password, sessions and signing in",
    summary: "Change your password, see where you're signed in, and what to do if you're locked out.",
    category: "Account and privacy",
    keywords: ["password", "locked out", "sign in", "login", "session", "security", "forgot"],
    blocks: [
      { p: "In Settings you can change your name and password, and see every device you're signed in on. Changing your password signs out your other sessions." },
      { p: "After several wrong passwords in a row, the account is locked for a short time to protect it. Wait and try again." },
      { tip: "Can't get in at all? Use the contact form at the bottom of this help center. You don't need to be signed in." },
    ],
    links: [{ href: "/settings", label: "Open Settings" }],
  },
  {
    slug: "your-data",
    title: "Your data: what we keep, and deleting it",
    summary: "What's stored, who it's shared with, and how to get a copy or delete your account.",
    category: "Account and privacy",
    keywords: ["privacy", "delete account", "export", "gdpr", "ccpa", "data", "remove", "close account"],
    blocks: [
      { p: "We store what you put into your account, plus the activity and screenshots from your applications. Your information goes to an employer only when you apply to that employer. We never sell it." },
      { p: "You can delete jobs, documents and saved answers yourself at any time. In Settings you can also remove saved sign-ins for employer sites." },
      { p: `To get a copy of your data or close your account, email ${COMPANY.privacyEmail} from the address on your account, or use Report a problem and choose "Privacy or my data".` },
    ],
    links: [{ href: "/privacy", label: "Read the Privacy Policy" }],
  },

  // ── Plans and billing ────────────────────────────────────────────────────
  {
    slug: "plans-and-billing",
    title: "Plans, billing and cancelling",
    summary: "How paid plans renew, how to cancel, and where to get a receipt.",
    category: "Plans and billing",
    keywords: ["price", "pricing", "subscription", "cancel", "refund", "invoice", "receipt", "upgrade", "downgrade", "stripe"],
    blocks: [
      { p: "Paid plans renew automatically each billing period until you cancel. Payments are handled by Stripe, and we never see your full card number." },
      { p: "When you cancel, you keep paid features until the end of the period you paid for, then move to the free plan. Your data stays." },
      { p: COMPANY.refundPolicy },
      { p: `For a billing question, use Report a problem and choose "Billing or my plan".` },
    ],
    links: [{ href: "/terms#billing", label: "Billing terms" }],
  },
];

export function getHelpArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.slug === slug);
}

function articleText(article: HelpArticle): string {
  const parts = [article.title, article.summary, article.category, ...(article.keywords ?? [])];
  for (const block of article.blocks) {
    if ("p" in block) parts.push(block.p);
    else if ("tip" in block) parts.push(block.tip);
    else if ("h" in block) parts.push(block.h);
    else parts.push(...("steps" in block ? block.steps : block.list));
  }
  return parts.join(" ").toLowerCase();
}

/** Articles matching every word of the query, best title matches first. */
export function searchHelp(query: string, articles: HelpArticle[] = HELP_ARTICLES): HelpArticle[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return articles;
  return articles
    .map((article) => {
      const text = articleText(article);
      if (!words.every((w) => text.includes(w))) return null;
      const title = `${article.title} ${(article.keywords ?? []).join(" ")}`.toLowerCase();
      return { article, score: words.filter((w) => title.includes(w)).length };
    })
    .filter((x): x is { article: HelpArticle; score: number } => x !== null)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.article);
}
