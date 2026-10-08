import type { Metadata } from "next";
import Link from "next/link";
import { COMPANY } from "@/config/company";
import { CompanyEmail, CompanyValue, LegalDocument, LegalSection, ReviewNote, type LegalSectionDef } from "@/components/legal/legal";

export const metadata: Metadata = { title: "Privacy Policy", description: `How ${COMPANY.productName} collects, uses and protects your information.` };

const SECTIONS: LegalSectionDef[] = [
  { id: "who-we-are", title: "Who we are" },
  { id: "information-you-give", title: "Information you give us" },
  { id: "information-collected", title: "Information we collect automatically" },
  { id: "other-sources", title: "Information from other sources" },
  { id: "how-we-use", title: "How we use your information" },
  { id: "ai", title: "AI features" },
  { id: "applying", title: "Applying to jobs for you" },
  { id: "sharing", title: "Who we share information with" },
  { id: "never", title: "What we never do" },
  { id: "cookies", title: "Cookies and local storage" },
  { id: "security", title: "How we protect your information" },
  { id: "retention", title: "How long we keep it" },
  { id: "rights", title: "Your choices and rights" },
  { id: "children", title: "Children" },
  { id: "international", title: "Where your information is stored" },
  { id: "changes", title: "Changes to this policy" },
  { id: "contact", title: "Contact us" },
];

const section = (id: string) => {
  const index = SECTIONS.findIndex((s) => s.id === id);
  return { section: SECTIONS[index]!, index: index + 1 };
};

export default function PrivacyPage() {
  const name = COMPANY.productName;
  return (
    <LegalDocument
      title="Privacy Policy"
      sections={SECTIONS}
      intro={
        <p>
          {name} helps you find jobs, prepare applications and track them. To do that it has to hold a lot of personal information: your work history, your resume and,
          if you choose, answers about salary, work authorization and demographics. This policy explains in plain language what we collect, why, who sees it, and the
          choices you have.
        </p>
      }
    >
      <LegalSection {...section("who-we-are")}>
        <p>
          {name} is provided by <CompanyValue value={COMPANY.legalName} />, <CompanyValue value={COMPANY.entityDescription} /> (&quot;we&quot;, &quot;us&quot;). We are
          responsible for the personal information described in this policy. You can reach us at <CompanyEmail value={COMPANY.privacyEmail} /> or by mail at{" "}
          <CompanyValue value={COMPANY.mailingAddress} />.
        </p>
      </LegalSection>

      <LegalSection {...section("information-you-give")}>
        <ul>
          <li>
            <strong>Account details:</strong> your name, email address and password. We store only a one-way hash of your password (argon2id), never the password itself.
          </li>
          <li>
            <strong>Your Master Profile:</strong> contact details and address, links to your LinkedIn, portfolio, website or GitHub, job titles you want, a summary,
            years of experience, industries, skills, employment history (employers, titles, dates, locations, responsibilities and achievements), and education
            (schools, degrees, majors, GPA, coursework and dates).
          </li>
          <li>
            <strong>Documents:</strong> resumes, cover letters, certifications, transcripts and portfolios you upload, and the text we read from a resume when you use
            resume import.
          </li>
          <li>
            <strong>Your Answer Library:</strong> saved answers to common application questions. These can include salary expectations, work authorization and visa
            sponsorship status, willingness to relocate or travel, availability, and, only if you choose to provide them, answers to voluntary demographic questions
            such as gender, race or ethnicity, veteran status and disability status.
          </li>
          <li>
            <strong>Jobs and preferences:</strong> jobs you save or import, keywords and job boards you search, your automation rules (minimum match score, salary floor,
            locations, excluded companies and keywords) and your settings.
          </li>
          <li>
            <strong>Tracking information:</strong> the stage of each application, interview dates and notes, and outcomes you record.
          </li>
          <li>
            <strong>Support messages:</strong> what you send us through &quot;Report a problem&quot; or the help center, including the page you sent it from.
          </li>
          <li>
            <strong>Payment information:</strong> if you buy a paid plan, our payment processor (Stripe) collects your card details. We receive only limited details
            such as your plan, billing status and the last four digits of your card. We never see or store your full card number.
          </li>
        </ul>
      </LegalSection>

      <LegalSection {...section("information-collected")}>
        <ul>
          <li>
            <strong>Sign-in and security records:</strong> when you sign in we record the time, your IP address and your browser and device type, so you can see and end
            your active sessions in Settings and so we can detect suspicious activity. Important account actions are kept in a security log.
          </li>
          <li>
            <strong>Application activity:</strong> while {name} fills in an application it records each step (for example &quot;resume uploaded&quot;), any errors, and
            screenshots of the application pages so you can see exactly what was entered.
          </li>
          <li>
            <strong>Employer site sign-ins:</strong> if you sign in to an employer&apos;s careers site during an application, we keep that site&apos;s session cookies so you
            don&apos;t have to sign in again next time. You can remove them at any time in Settings.
          </li>
        </ul>
        <p>We do not use advertising trackers or third-party analytics that follow you across other websites.</p>
        <ReviewNote>If a product analytics or error-monitoring tool is added before launch, list it here and in the service providers in section 8.</ReviewNote>
      </LegalSection>

      <LegalSection {...section("other-sources")}>
        <ul>
          <li>
            <strong>Job postings:</strong> we read the public job posting pages you save, and when you search for jobs, companies&apos; public job board listings
            (Greenhouse, Lever, Ashby, Workday, Workable, SmartRecruiters and Recruitee). If search across job sites is turned on, the words and place you search for are
            also sent to JSearch, a job listings service, which returns matching listings.
          </li>
          <li>
            <strong>LinkedIn:</strong> we only read a LinkedIn data export file you download from LinkedIn and upload to us, or links you paste. {name} never signs in to
            LinkedIn or acts on LinkedIn for you.
          </li>
          <li>
            <strong>Email and calendar, only if you connect them:</strong> if you connect a Google or Microsoft account, {name} reads messages and calendar events to spot
            updates about your job applications, such as interview invitations, rejections and offers, and updates your tracker. You can disconnect at any time, which
            stops further access.
          </li>
          <li>
            <strong>Browser extension, only if you install it:</strong> when you click to save a job, the extension sends us that page&apos;s address and job details. It
            does not read pages you don&apos;t save.
          </li>
        </ul>
        <ReviewNote>
          Confirm the email and calendar wording against the final email sync feature: which permissions (scopes) it requests, whether it keeps message contents or
          only the detected update, and how long. Google requires apps using Gmail data to follow its API Services User Data Policy, including the Limited Use rules,
          and to say so here. Confirm the browser extension wording against the extension as built.
        </ReviewNote>
      </LegalSection>

      <LegalSection {...section("how-we-use")}>
        <p>We use your information to:</p>
        <ul>
          <li>provide the service: score jobs against your profile, fill in and submit applications in the way you&apos;ve allowed, and track their progress;</li>
          <li>ask you when something needs a person, such as a CAPTCHA, a sign-in, a question we can&apos;t answer from your profile, or a final review;</li>
          <li>send you emails about your account and, if you leave notifications on, about your applications;</li>
          <li>keep your account secure, prevent abuse and fix problems;</li>
          <li>answer your support messages;</li>
          <li>process payments for paid plans; and</li>
          <li>meet our legal obligations.</li>
        </ul>
        <p>We do not use your resume, profile or application content to advertise to you, and we do not sell it.</p>
        <p>
          A small number of our staff can see account details, plan and billing status, and application failures in an internal admin panel, so they can support you
          and keep the service running. Each time staff open an account&apos;s details, it is recorded in a log.
        </p>
        <ReviewNote>
          If users are in the EU, UK or a similar jurisdiction, add the legal basis for each use (for example contract, legitimate interests, consent for demographic
          answers).
        </ReviewNote>
      </LegalSection>

      <LegalSection {...section("ai")}>
        <p>
          When AI is turned on in Settings, {name} sends the information needed for each task to our AI provider (Anthropic or OpenAI, depending on the AI setting). Depending on the task this
          includes job postings, the questions on an application form, and relevant parts of your profile, Answer Library and resume. AI is used to read job postings,
          read a resume you import, recognize form fields, draft answers, and tailor resumes and cover letters.
        </p>
        <ul>
          <li>Everything the AI writes is checked against your Master Profile, and anything it can&apos;t back up from your own information is removed or flagged.</li>
          <li>Answers and documents the AI drafts are not sent to an employer until you approve them.</li>
          <li>Our AI provider processes this information to perform the task for us, under its commercial terms.</li>
          <li>When AI is off, {name} uses built-in rules instead and nothing is sent to an AI provider.</li>
        </ul>
        <ReviewNote>
          Confirm the AI provider&apos;s current commercial terms (whether API inputs are used for training, and how long they are retained) and state them here.
        </ReviewNote>
      </LegalSection>

      <LegalSection {...section("applying")}>
        <p>
          Applying for a job means sending your information to the employer. When {name} applies for you, it enters your details, uploads your documents and answers the
          employer&apos;s questions on the employer&apos;s own careers site, which is often run by a hiring software company such as Workday, Greenhouse, Lever, Ashby or
          SmartRecruiters. Once submitted, the employer and its hiring software company handle your information under their own privacy policies.
        </p>
        <p>
          You choose how much {name} does on its own: Manual, Review (you check every application before it&apos;s sent) or Auto. Saved answers you&apos;ve marked for
          review are never used without your say-so, and demographic questions are answered only with answers you saved yourself; otherwise they are left for you.
        </p>
      </LegalSection>

      <LegalSection {...section("sharing")}>
        <p>We share personal information only:</p>
        <ul>
          <li>with employers and their hiring software, when you apply to a job through {name};</li>
          <li>with companies that help us run the service, who may use it only to provide their service to us (listed below);</li>
          <li>when the law requires it, or to protect the rights, safety or security of our users, us or others;</li>
          <li>as part of a merger, acquisition or sale of our business, in which case we will tell you before your information becomes subject to a different policy; or</li>
          <li>with your permission.</li>
        </ul>
        <h3>Service providers</h3>
        <ul>
          {COMPANY.serviceProviders.map((p) => (
            <li key={p.name}>
              <CompanyValue value={p.name} />: {p.purpose}
            </li>
          ))}
        </ul>
        <p>
          <strong>We do not sell your personal information</strong> and we do not share it for cross-context behavioral advertising.
        </p>
      </LegalSection>

      <LegalSection {...section("never")}>
        <ul>
          <li>We never get around CAPTCHAs, two-factor codes or other security checks. When a site asks for one, {name} stops and asks you.</li>
          <li>We never make up qualifications, experience or answers. What we submit comes from what you&apos;ve told us.</li>
          <li>We never sign in to LinkedIn or apply through LinkedIn Easy Apply for you.</li>
          <li>We never sell your data or show you ads based on it.</li>
        </ul>
      </LegalSection>

      <LegalSection {...section("cookies")}>
        <p>
          We use one essential cookie to keep you signed in. It holds a random token; we store only a hash of it. We also keep small preferences, such as light or dark
          mode, in your browser&apos;s local storage. We don&apos;t use advertising cookies, so there is nothing to opt out of.
        </p>
      </LegalSection>

      <LegalSection {...section("security")}>
        <ul>
          <li>Passwords are hashed with argon2id and sign-in tokens are stored only as hashes.</li>
          <li>
            Answers to voluntary demographic questions and saved employer sign-in sessions get an extra layer of encryption (AES-256) before they are stored.
          </li>
          <li>Uploaded documents are kept in encrypted file storage and are only available to your account.</li>
          <li>Information travels over encrypted connections (HTTPS).</li>
          <li>Repeated failed sign-ins lock the account temporarily, and you can end any active session from Settings.</li>
        </ul>
        <p>
          No system is perfectly secure. If we learn of a security breach that affects your personal information, we will notify you and the authorities as the law
          requires.
        </p>
        <ReviewNote>
          Salary expectations and work authorization answers are protected by database and storage encryption, not by the extra field-level encryption above. Decide
          whether to extend field-level encryption to them before launch; the text above is accurate either way.
        </ReviewNote>
      </LegalSection>

      <LegalSection {...section("retention")}>
        <ul>
          <li>We keep your information while your account is open, so your profile, applications and history are there when you need them.</li>
          <li>You can delete jobs, documents and saved answers yourself at any time.</li>
          <li>
            When you close your account, we delete your information within {COMPANY.deletionWindowDays} days, except what the law requires us to keep (for example
            billing records). Copies in backups are overwritten within a further {COMPANY.backupRetentionDays} days.
          </li>
          <li>Information an employer already received stays with that employer, and you would need to ask them to delete it.</li>
        </ul>
        <ReviewNote>
          Account closure is handled by request to the privacy email today; there is no self-serve &quot;delete my account&quot; or &quot;export my data&quot; button yet.
          The screenshot retention setting in Settings is saved but not yet enforced. Both should be built, or this section adjusted, before launch.
        </ReviewNote>
      </LegalSection>

      <LegalSection {...section("rights")}>
        <p>You can see and change most of your information directly in {name}. You can also ask us to:</p>
        <ul>
          <li>give you a copy of your personal information;</li>
          <li>correct information that&apos;s wrong;</li>
          <li>delete your information and close your account;</li>
          <li>stop a particular use of your information, such as AI processing (you can also turn AI off in Settings); or</li>
          <li>withdraw consent you gave, such as for demographic answers (delete them from your Answer Library).</li>
        </ul>
        <p>
          Email <CompanyEmail value={COMPANY.privacyEmail} /> from the address on your account. We may need to confirm it&apos;s you before acting. Depending on where you
          live, you may have further rights under local law, including the right to complain to a data protection authority. We will not treat you differently for
          using these rights.
        </p>
        <p>
          You can turn off application notification emails in Settings. We will still send messages needed to run your account, such as security alerts and receipts.
        </p>
      </LegalSection>

      <LegalSection {...section("children")}>
        <p>
          {name} is for people who are at least {COMPANY.minimumAge} years old. We do not knowingly collect information from anyone younger. If you believe a child has
          given us information, contact us and we will delete it.
        </p>
      </LegalSection>

      <LegalSection {...section("international")}>
        <p>
          Your information is stored and processed in <CompanyValue value={COMPANY.dataHostingRegion} />. Our service providers, and the employers you apply to, may
          process it in other countries. Where the law requires it, we use appropriate safeguards for these transfers.
        </p>
      </LegalSection>

      <LegalSection {...section("changes")}>
        <p>
          We will update this policy as {name} changes. If a change is significant, we will tell you by email or in the app before it takes effect. The date at the top
          shows when it last changed.
        </p>
      </LegalSection>

      <LegalSection {...section("contact")}>
        <p>
          Questions about privacy: <CompanyEmail value={COMPANY.privacyEmail} />. Mail: <CompanyValue value={COMPANY.legalName} />,{" "}
          <CompanyValue value={COMPANY.mailingAddress} />. For anything else, visit the{" "}
          <Link href="/help" className="text-primary font-medium hover:underline">
            help center
          </Link>
          .
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
