import { describe, expect, it, vi } from "vitest";
import { adzunaQuery, museQuery, searchEverywhere, searchFeeds, type HttpFetcher } from "../src";

function fakeHttp(routes: Array<[RegExp, unknown]>) {
  return vi.fn<HttpFetcher>(async (url) => {
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) throw new Error("The posting was not found (it may have closed)");
    if (route[1] instanceof Error) throw route[1];
    return { url, status: 200, contentType: "application/json", text: JSON.stringify(route[1]) };
  });
}

const MUSE = {
  results: [
    { id: 1, name: "Sales Development Representative", contents: "<p>Book meetings for our FinTech sales team.</p>", publication_date: "2026-10-06T21:46:00Z", locations: [{ name: "New York, NY" }], refs: { landing_page: "https://www.themuse.com/jobs/acme/sdr" }, company: { name: "Acme" } },
    { id: 2, name: "Account Executive", contents: "<p>Close deals.</p>", publication_date: "2026-10-05T10:00:00Z", locations: [{ name: "Chicago, IL" }], refs: { landing_page: "https://www.themuse.com/jobs/globex/ae" }, company: { name: "Globex" } },
  ],
};
const HIMALAYAS = { jobs: [{ title: "Sales Development Representative", companyName: "Remotely", locationRestrictions: ["United States"], pubDate: 1791000000, guid: "https://himalayas.app/companies/remotely/jobs/sdr", minSalary: 60000, maxSalary: 70000, currency: "USD", salaryPeriod: "annual" }] };
const JOBICY = { jobs: [{ id: 7, url: "https://jobicy.com/jobs/7-sdr", jobTitle: "SDR", companyName: "Cloudy", jobGeo: "USA", pubDate: "2026-10-08T19:08:02+00:00" }] };
const ADZUNA = {
  results: [
    { id: "a1", title: "<strong>Account Executive</strong>", redirect_url: "https://www.adzuna.com/details/a1", company: { display_name: "Initech" }, location: { display_name: "New York, NY" }, created: "2026-10-07T00:00:00Z", salary_min: 80000, salary_max: 90000, salary_is_predicted: "0" },
    { id: "a2", title: "Account Executive", redirect_url: "https://www.adzuna.com/details/a2", company: { display_name: "Vandelay" }, location: { display_name: "Austin, TX" }, salary_min: 50000, salary_max: 50000, salary_is_predicted: "1" },
  ],
};

const routes: Array<[RegExp, unknown]> = [
  [/^https:\/\/www\.themuse\.com\/api\/public\/jobs\?.*page=0/, MUSE],
  [/^https:\/\/www\.themuse\.com\/api\/public\/jobs\?/, { results: [] }],
  [/^https:\/\/himalayas\.app\/jobs\/api\/search\?/, HIMALAYAS],
  [/^https:\/\/jobicy\.com\/api\/v2\/remote-jobs\?/, JOBICY],
  [/^https:\/\/api\.adzuna\.com\/v1\/api\/jobs\/us\/search\/1\?/, ADZUNA],
];

describe("job feed queries", () => {
  it("turns roles, level and city into The Muse's categories, level and location", () => {
    const params = museQuery({ terms: ["Account Executive", "Investment Banking"], matchAny: true, location: "NYC", hints: ["Entry Level"] })!;
    expect(params.getAll("category")).toEqual(["Sales", "Accounting and Finance"]);
    expect(params.getAll("level")).toEqual(["Entry Level"]);
    expect(params.get("location")).toBe("New York, NY");
    expect(params.get("descending")).toBe("true");
    // Nothing The Muse files jobs under: skip it rather than list everything.
    expect(museQuery({ terms: ["Underwater Welding"], matchAny: false })).toBeNull();
  });

  it("asks Adzuna for any of the words, near the place spelled out", () => {
    const params = adzunaQuery({ terms: ["Account Executive", "SaaS"], matchAny: true, location: "NYC" })!;
    expect(params.get("what_or")).toBe("account executive saas");
    expect(params.get("where")).toBe("New York");
    expect(adzunaQuery({ terms: ["Account Executive"], matchAny: false, location: "Remote" })!.get("where")).toBeNull();
  });
});

describe("searchFeeds", () => {
  it("reads every feed that fits, linking back to each one", async () => {
    const http = fakeHttp(routes);
    const { hits, feeds } = await searchFeeds({ terms: ["sales development representative"], matchAny: false }, { adzuna: { appId: "id", appKey: "key" } }, http);
    expect(feeds.map((f) => [f.feed, f.status])).toEqual([
      ["themuse", "used"],
      ["himalayas", "used"],
      ["jobicy", "used"],
      ["adzuna", "used"],
    ]);
    expect(hits.find((h) => h.company === "Remotely")).toMatchObject({ url: "https://himalayas.app/companies/remotely/jobs/sdr", location: "Remote (United States)", workArrangement: "REMOTE", salaryText: "USD 60,000 - 70,000 per year", publishers: ["Himalayas"] });
    expect(hits.find((h) => h.company === "Cloudy")).toMatchObject({ url: "https://jobicy.com/jobs/7-sdr", publishers: ["Jobicy"] });
    expect(hits.find((h) => h.company === "Initech")).toMatchObject({ title: "Account Executive", salaryText: "USD 80,000 - 90,000 per year", publishers: ["Adzuna"] });
    // Adzuna's guessed salaries aren't shown as if they were posted.
    expect(hits.find((h) => h.company === "Vandelay")!.salaryText).toBeNull();
  });

  it("skips remote-only feeds for a city and Adzuna without a key", async () => {
    const http = fakeHttp(routes);
    const { feeds } = await searchFeeds({ terms: ["account executive"], matchAny: false, location: "New York" }, {}, http);
    expect(feeds.map((f) => [f.feed, f.status, f.reason])).toEqual([
      ["themuse", "used", undefined],
      ["himalayas", "skipped", "remote jobs only"],
      ["jobicy", "skipped", "remote jobs only"],
      ["adzuna", "skipped", "no key"],
    ]);
    expect(http.mock.calls.every((c) => new URL(c[0]).host === "www.themuse.com")).toBe(true);
  });

  it("reports a feed that fails without losing the others, and caches answers", async () => {
    const http = fakeHttp([[/himalayas/, new Error("Request failed with status 429")], ...routes]);
    const search = { terms: ["sales"], matchAny: false };
    const first = await searchFeeds(search, {}, http);
    expect(first.feeds.find((f) => f.feed === "himalayas")).toMatchObject({ status: "failed", reason: "its request limit was reached" });
    expect(first.hits.length).toBeGreaterThan(0);
    const calls = http.mock.calls.length;
    await searchFeeds(search, {}, http);
    // Only the failed feed is asked again.
    expect(http.mock.calls.slice(calls).map((c) => new URL(c[0]).host)).toEqual(["himalayas.app"]);
  });
});

describe("searchEverywhere with feeds and preferences", () => {
  const directory = ["greenhouse:acme"];
  const boardRoutes: Array<[RegExp, unknown]> = [
    [
      /^https:\/\/boards-api\.greenhouse\.io\/v1\/boards\/acme\/jobs/,
      {
        jobs: [
          { id: 1, title: "Account Executive", company_name: "Acme", location: { name: "San Francisco, CA" }, first_published: "2026-10-08T00:00:00Z" },
          { id: 2, title: "Account Executive, FinTech", company_name: "Acme", location: { name: "New York, NY" }, first_published: "2026-10-01T00:00:00Z" },
          { id: 3, title: "AI Research Scientist", company_name: "Acme", location: { name: "London" }, first_published: "2026-10-08T00:00:00Z" },
        ],
      },
    ],
    ...routes,
  ];

  it("lists jobs that fit more preferences first and says which they fit", async () => {
    const result = await searchEverywhere(
      { query: "account executive", directory, feeds: {}, preferences: { keywords: ["Account Executive", "FinTech"], places: ["NYC"] } },
      fakeHttp(boardRoutes),
    );
    expect(result.jobs[0]).toMatchObject({ title: "Account Executive, FinTech", fits: ["Account Executive", "FinTech", "NYC"] });
    // The Muse's Chicago job is found too, below the ones that fit better.
    expect(result.jobs.map((j) => j.company)).toContain("Globex");
    expect(result.feeds.find((f) => f.feed === "themuse")).toMatchObject({ status: "used", found: 1 });
  });

  it("keeps new openings to the preferred places", async () => {
    const result = await searchEverywhere(
      {
        query: "",
        terms: { include: ["Account Executive", "AI", "Sales Development Representative"], exclude: [] },
        matchAny: true,
        directory,
        feeds: {},
        preferences: { keywords: ["Account Executive", "AI", "Sales Development Representative"], places: ["NYC"] },
        onlyPreferredPlaces: true,
        searchNear: "NYC",
      },
      fakeHttp(boardRoutes),
    );
    expect(result.jobs.map((j) => `${j.company}: ${j.title}`)).toEqual(["Acme: Sales Development Representative", "Acme: Account Executive, FinTech"]);
  });

  it("finds New York jobs when the location is typed as NYC", async () => {
    const result = await searchEverywhere({ query: "account executive", location: "NYC", directory }, fakeHttp(boardRoutes));
    expect(result.jobs.map((j) => j.title)).toEqual(["Account Executive, FinTech"]);
  });
});
