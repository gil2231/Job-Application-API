import type { HttpFetcher } from "@autoapply/ingestion";

/**
 * Stand-in job boards for end-to-end tests and local demos, used only when
 * E2E_FAKE_JOB_SOURCES=1 outside production. The companies are made up.
 */
export const FAKE_DIRECTORY = ["greenhouse:acme", "lever:globex", "ashby:initech", "workday:umbrella.wd5/Careers", "smartrecruiters:Hooli", "workable:piedpiper", "greenhouse:closedco"];

const day = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();
const description = (role: string) =>
  `<p>We're hiring a ${role} to grow our customer base. You'll run discovery calls, build pipeline with our SaaS and FinTech customers, and work closely with marketing on go-to-market plans. Full-time, entry level welcome.</p>`;

const greenhouse = {
  jobs: [
    { id: 11, title: "Account Executive, FinTech", company_name: "Acme", location: { name: "New York, NY" }, content: description("Account Executive"), first_published: ago(1) },
    { id: 12, title: "Business Development Representative", company_name: "Acme", location: { name: "New York, NY" }, content: description("Business Development Representative"), first_published: ago(2) },
    { id: 13, title: "Senior Software Engineer", company_name: "Acme", location: { name: "Remote" }, content: "<p>Build our platform.</p>", first_published: ago(3) },
  ],
};

const ROUTES: Array<[RegExp, unknown | ((body: string | undefined) => unknown)]> = [
  [/^https:\/\/boards-api\.greenhouse\.io\/v1\/boards\/acme\/jobs/, greenhouse],
  [
    /^https:\/\/api\.lever\.co\/v0\/postings\/globex/,
    [
      { id: "1a2b3c4d-0000-0000-0000-000000000001", text: "Sales Development Representative", categories: { location: "Remote - US" }, descriptionPlain: "Book meetings for our account executives.", hostedUrl: "https://jobs.lever.co/globex/1a2b3c4d-0000-0000-0000-000000000001", createdAt: Date.now() - 2 * day, workplaceType: "remote", salaryRange: { min: 60000, max: 75000, currency: "USD", interval: "per-year-salary" } },
      { id: "1a2b3c4d-0000-0000-0000-000000000002", text: "Customer Success Manager", categories: { location: "New York, NY" }, descriptionPlain: "Keep our customers renewing.", hostedUrl: "https://jobs.lever.co/globex/1a2b3c4d-0000-0000-0000-000000000002", createdAt: Date.now() - 4 * day },
    ],
  ],
  [/^https:\/\/api\.ashbyhq\.com\/posting-api\/job-board\/initech/, { jobs: [{ id: "a1", title: "Product Marketing Manager", location: "San Francisco, CA", jobUrl: "https://jobs.ashbyhq.com/initech/a1", descriptionPlain: "Launch our AI products.", publishedAt: ago(5) }] }],
  [
    /^https:\/\/umbrella\.wd5\.myworkdayjobs\.com\/wday\/cxs\/umbrella\/Careers\/jobs$/,
    { total: 2, jobPostings: [{ title: "Investment Banking Analyst", externalPath: "/job/New-York-NY/Investment-Banking-Analyst_R100", locationsText: "New York, NY", postedOn: "Posted Today" }, { title: "Graduate Analyst, Rotational Program", externalPath: "/job/Jersey-City-NJ/Graduate-Analyst_R101", locationsText: "Jersey City, NJ", postedOn: "Posted 2 Days Ago" }] },
  ],
  [/^https:\/\/api\.smartrecruiters\.com\/v1\/companies\/Hooli\/postings/, { content: [{ id: "744000001", name: "Account Executive", company: { name: "Hooli" }, releasedDate: ago(1), location: { city: "New York", region: "NY", country: "us" } }] }],
  [/^https:\/\/apply\.workable\.com\/api\/v1\/widget\/accounts\/piedpiper/, { name: "Pied Piper", jobs: [{ title: "Revenue Operations Analyst", shortcode: "PP1", url: "https://apply.workable.com/piedpiper/j/PP1/", city: "New York", state: "NY", country: "United States", published_on: ago(3).slice(0, 10) }] }],
  [
    /^https:\/\/jsearch\.p\.rapidapi\.com\/search-v2\?/,
    {
      data: {
        jobs: [
          { job_id: "j1", employer_name: "Acme", job_title: "Account Executive, FinTech", job_location: "New York, NY", job_publisher: "LinkedIn", job_apply_link: "https://www.linkedin.com/jobs/view/1", apply_options: [{ publisher: "LinkedIn", apply_link: "https://www.linkedin.com/jobs/view/1" }] },
          { job_id: "j2", employer_name: "Vandelay Industries", job_title: "Account Executive", job_location: "New York, NY", job_publisher: "Indeed", job_apply_link: "https://www.indeed.com/viewjob?jk=2", apply_options: [{ publisher: "Indeed", apply_link: "https://www.indeed.com/viewjob?jk=2" }, { publisher: "LinkedIn", apply_link: "https://www.linkedin.com/jobs/view/2" }], job_posted_at_datetime_utc: ago(1), job_min_salary: 70000, job_max_salary: 90000, job_salary_period: "YEAR" },
        ],
      },
    },
  ],
  // The free feeds: one New York listing on The Muse; the rest have nothing new.
  [
    /^https:\/\/www\.themuse\.com\/api\/public\/jobs\?.*page=0/,
    { results: [{ id: 501, name: "Account Executive", contents: "<p>Sell paper to New York offices.</p>", publication_date: ago(2), locations: [{ name: "New York, NY" }], refs: { landing_page: "https://www.themuse.com/jobs/kramerica/account-executive" }, company: { name: "Kramerica" } }] },
  ],
  [/^https:\/\/www\.themuse\.com\/api\/public\/jobs\?/, { results: [] }],
  [/^https:\/\/himalayas\.app\/jobs\/api\/search\?/, { jobs: [] }],
  [/^https:\/\/jobicy\.com\/api\/v2\/remote-jobs\?/, { jobs: [] }],
  [/^https:\/\/api\.adzuna\.com\/v1\/api\/jobs\/us\/search\/1\?/, { results: [] }],
];

export const fakeJobSources: HttpFetcher = async (url, init) => {
  await new Promise((resolve) => setTimeout(resolve, 150));
  const route = ROUTES.find(([pattern]) => pattern.test(url));
  if (!route) throw new Error("The posting was not found (it may have closed)");
  const body = typeof route[1] === "function" ? (route[1] as (b: string | undefined) => unknown)(init.body) : route[1];
  return { url, status: 200, contentType: "application/json", text: JSON.stringify(body) };
};
