import type { AIProvider, CompletionRequest, WritingJob, WritingProfile } from "../src";

export const PROFILE: WritingProfile = {
  firstName: "Jordan",
  lastName: "Rivera",
  email: "jordan@example.com",
  phone: "212-555-0100",
  city: "New York",
  state: "NY",
  linkedinUrl: "https://www.linkedin.com/in/jordan-rivera",
  currentTitle: "Account Executive",
  summary: null,
  yearsExperience: null,
  employment: [
    {
      company: "Brightwave",
      title: "Account Executive",
      location: "New York, NY",
      startDate: "2022-03-01",
      isCurrent: true,
      achievements: ["Closed $1.2M in new ARR in 2024, 130% of quota", "Built a Salesforce dashboard the team uses for pipeline reviews"],
      responsibilities: ["Run discovery calls and demos for mid-market finance teams", "Partner with customer success on renewals"],
      skills: ["Salesforce", "Cold calling"],
    },
    {
      company: "Northline Software",
      title: "Sales Development Representative",
      startDate: "2020-01-01",
      endDate: "2022-02-28",
      achievements: ["Booked 45 qualified meetings per quarter through outbound prospecting"],
      responsibilities: ["Prospected with Outreach sequences", "Researched accounts in LinkedIn Sales Navigator"],
      skills: ["Outreach"],
    },
  ],
  education: [{ school: "Rutgers University", degree: "Bachelor of Arts", major: "Communication", graduationDate: "2019-05-15", gpa: 3.6 }],
  skills: [{ name: "Salesforce" }, { name: "HubSpot" }, { name: "Negotiation" }, { name: "Spanish" }],
};

export const JOB: WritingJob = {
  id: "job_1",
  title: "Senior Account Executive",
  company: "Acme Payments",
  description: "We're hiring a Senior Account Executive to sell to finance teams. You'll run demos, manage pipeline in Salesforce and negotiate multi-year deals. Experience with HubSpot is a plus. Kubernetes knowledge is not required.",
  skills: ["Salesforce", "Negotiation", "HubSpot"],
};

export const NOW = new Date("2026-06-01T00:00:00Z");

export function fakeProvider(respond: (req: CompletionRequest) => unknown): AIProvider & { calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = [];
  return {
    id: "fake",
    model: "fake-model",
    calls,
    async complete(req) {
      calls.push(req);
      const out = await respond(req);
      if (out instanceof Error) throw out;
      return { text: typeof out === "string" ? out : JSON.stringify(out), model: "fake-model-1" };
    },
  };
}
