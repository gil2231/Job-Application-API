import type { Metadata } from "next";
import Link from "next/link";
import { COMPANY } from "@/config/company";
import { CompanyEmail, CompanyValue, LegalDocument, LegalSection, ReviewNote, type LegalSectionDef } from "@/components/legal/legal";

export const metadata: Metadata = { title: "Terms of Service", description: `The terms for using ${COMPANY.productName}.` };

const SECTIONS: LegalSectionDef[] = [
  { id: "agreement", title: "Agreeing to these terms" },
  { id: "service", title: "What the service does" },
  { id: "accounts", title: "Eligibility and your account" },
  { id: "authorization", title: "Acting on your behalf" },
  { id: "responsibilities", title: "Your responsibilities" },
  { id: "acceptable-use", title: "Acceptable use" },
  { id: "ai", title: "AI-generated content" },
  { id: "third-parties", title: "Other websites and services" },
  { id: "no-guarantee", title: "No guarantee of results" },
  { id: "billing", title: "Plans, billing and cancellation" },
  { id: "your-content", title: "Your content" },
  { id: "our-property", title: "Our property" },
  { id: "feedback", title: "Feedback" },
  { id: "termination", title: "Suspension and closing your account" },
  { id: "disclaimers", title: "Disclaimers" },
  { id: "liability", title: "Limitation of liability" },
  { id: "indemnity", title: "Indemnity" },
  { id: "law", title: "Governing law and disputes" },
  { id: "changes", title: "Changes to these terms" },
  { id: "general", title: "General" },
  { id: "contact", title: "Contact us" },
];

const section = (id: string) => {
  const index = SECTIONS.findIndex((s) => s.id === id);
  return { section: SECTIONS[index]!, index: index + 1 };
};

export default function TermsPage() {
  const name = COMPANY.productName;
  return (
    <LegalDocument
      title="Terms of Service"
      sections={SECTIONS}
      intro={
        <p>
          These terms are an agreement between you and <CompanyValue value={COMPANY.legalName} /> (&quot;we&quot;, &quot;us&quot;) about your use of {name}. Please read
          them carefully. Our{" "}
          <Link href="/privacy" className="text-primary font-medium hover:underline">
            Privacy Policy
          </Link>{" "}
          explains how we handle your information.
        </p>
      }
    >
      <LegalSection {...section("agreement")}>
        <p>
          By creating an account or using {name}, you agree to these terms. If you don&apos;t agree, don&apos;t use the service. If you use {name} for an organization,
          you confirm you&apos;re allowed to accept these terms for it.
        </p>
      </LegalSection>

      <LegalSection {...section("service")}>
        <p>
          {name} helps you manage a job search. It imports jobs you save, scores them against your Master Profile, prepares applications from your own information,
          fills in and, where you allow it, submits applications on employers&apos; careers sites, and tracks what happens next. It stops and asks you whenever a person
          is needed, such as for a CAPTCHA, a sign-in, a question it can&apos;t answer from your information, or a final review.
        </p>
        <p>We may change, add or remove features over time. If we remove something important to a paid plan, we will tell you in advance.</p>
      </LegalSection>

      <LegalSection {...section("accounts")}>
        <ul>
          <li>You must be at least {COMPANY.minimumAge} years old to use {name}.</li>
          <li>Give us accurate account information and keep it up to date.</li>
          <li>Keep your password private. You are responsible for what happens in your account, and should tell us at once if you think someone else has accessed it.</li>
          <li>One person per account. Don&apos;t share your account or create one for someone else without their permission.</li>
        </ul>
      </LegalSection>

      <LegalSection {...section("authorization")}>
        <p>
          You authorize {name} to fill in and submit job applications for you, using the information and documents in your account, in the way your settings allow. You
          choose the level of automation:
        </p>
        <ul>
          <li>
            <strong>Manual</strong>: {name} fills in the application and you click Submit yourself.
          </li>
          <li>
            <strong>Review</strong>: {name} fills in the application and waits for you to approve it before submitting.
          </li>
          <li>
            <strong>Auto</strong>: {name} submits applications that meet your rules without asking first. Auto submission is off until you turn it on.
          </li>
        </ul>
        <p>
          An application submitted through {name} is your application, made in your name. You can pause automation or change your settings at any time; this does not
          withdraw applications already submitted.
        </p>
      </LegalSection>

      <LegalSection {...section("responsibilities")}>
        <ul>
          <li>
            The information in your profile, documents and Answer Library must be true and yours. {name} submits what you give it, so keep it accurate and current.
          </li>
          <li>Review applications, especially in Auto mode, and check the answers and documents that will be sent.</li>
          <li>
            Follow the terms of the employer sites and other services you use with {name}. Some sites may not allow automated applications, and you&apos;re responsible
            for deciding whether to use {name} with them.
          </li>
          <li>Keep your own copies of important documents.</li>
        </ul>
        <ReviewNote>
          Consider whether employer careers sites&apos; terms of use restrict automated submission, and whether this allocation of responsibility to the user is
          appropriate.
        </ReviewNote>
      </LegalSection>

      <LegalSection {...section("acceptable-use")}>
        <p>You agree not to:</p>
        <ul>
          <li>submit false, misleading or someone else&apos;s information, or apply to jobs in another person&apos;s name;</li>
          <li>use {name} to get around CAPTCHAs, two-factor authentication or other security measures, or try to make it do so;</li>
          <li>use {name} to sign in to or automate LinkedIn, or any site whose terms you know forbid it;</li>
          <li>send spam, or overwhelm employers with applications you don&apos;t intend to pursue;</li>
          <li>upload anything unlawful, harmful or that you don&apos;t have the right to share, including malware;</li>
          <li>access other people&apos;s data, probe or attack our systems, or get around limits we put on the service;</li>
          <li>copy, resell or build a competing product from the service, or reverse engineer it except where the law allows; or</li>
          <li>use the service in a way that breaks the law.</li>
        </ul>
      </LegalSection>

      <LegalSection {...section("ai")}>
        <p>
          {name} can use AI to read job postings, map application forms, draft answers and tailor resumes and cover letters. AI can make mistakes. {name} checks what the
          AI writes against your own information and asks you to approve drafts before they&apos;re sent, but you are responsible for reviewing and approving what goes
          out in your name.
        </p>
      </LegalSection>

      <LegalSection {...section("third-parties")}>
        <p>
          {name} works with websites and services we don&apos;t control, including employers&apos; careers sites, hiring software such as Workday, Greenhouse, Lever,
          Ashby and SmartRecruiters, public job boards, and, if you connect them, your Google or Microsoft account. Your use of those is governed by their own terms and
          privacy policies. We are not responsible for them, for how employers handle your application, or for changes that stop {name} from working with a particular
          site.
        </p>
      </LegalSection>

      <LegalSection {...section("no-guarantee")}>
        <p>
          {name} helps you apply, but we can&apos;t promise any interview, job offer or response from an employer, that every application will submit successfully, or
          that job postings and match scores are accurate or complete. Match scores are an estimate to help you prioritize, not advice about any job.
        </p>
      </LegalSection>

      <LegalSection {...section("billing")}>
        <ul>
          <li>{name} offers a free plan and paid plans. What each plan includes and costs is shown on our pricing page when you choose it.</li>
          <li>
            Paid plans are billed in advance through our payment processor, Stripe, and <strong>renew automatically</strong> each billing period until you cancel. You
            authorize us to charge your payment method for each renewal.
          </li>
          <li>
            You can cancel at any time from your account. Cancelling stops future renewals; you keep paid features until the end of the period you&apos;ve paid for,
            then move to the free plan.
          </li>
          <li>
            <CompanyValue value={COMPANY.refundPolicy} />
          </li>
          <li>We will tell you at least 30 days before a price change affects your plan, so you can cancel before it applies.</li>
          <li>Prices don&apos;t include taxes unless stated; you pay any taxes that apply.</li>
          <li>If a payment fails, we may move your account to the free plan until it&apos;s fixed.</li>
        </ul>
        <ReviewNote>
          Many US states and other countries have automatic renewal laws (clear disclosure at checkout, easy online cancellation, renewal reminders). Confirm the
          checkout flow and these terms meet them. Fill in the refund policy.
        </ReviewNote>
      </LegalSection>

      <LegalSection {...section("your-content")}>
        <p>
          You own your content: your profile, documents, answers and everything else you add. You give us permission to store, copy, process and transmit it only as
          needed to run {name} for you, including sending it to employers when you apply and to our service providers as described in the Privacy Policy. This
          permission ends when you delete the content or close your account, except for copies already sent to employers and backups that are overwritten on schedule.
        </p>
        <p>Resumes and cover letters {name} tailors for you are yours to use as you like.</p>
      </LegalSection>

      <LegalSection {...section("our-property")}>
        <p>
          {name}, including its software, design and brand, belongs to us and our licensors. We give you a personal, non-transferable right to use it under these terms
          while your account is open. Nothing in these terms transfers our rights to you.
        </p>
      </LegalSection>

      <LegalSection {...section("feedback")}>
        <p>If you send us ideas or suggestions, we may use them without owing you anything.</p>
      </LegalSection>

      <LegalSection {...section("termination")}>
        <ul>
          <li>You can stop using {name} and ask us to close your account at any time.</li>
          <li>
            We may suspend or close your account if you seriously or repeatedly break these terms, if we must by law, or to protect other users, employers or the
            service. Where reasonable we will warn you first and give you a chance to fix the problem and download your information.
          </li>
          <li>If we stop offering {name} altogether, we will give you reasonable notice and refund any unused part of a prepaid plan.</li>
          <li>Sections that by their nature should survive closing an account (such as liability limits and disputes) continue to apply.</li>
        </ul>
      </LegalSection>

      <LegalSection {...section("disclaimers")}>
        <p className="uppercase">
          To the fullest extent the law allows, {name} is provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any kind, whether express or
          implied, including warranties of merchantability, fitness for a particular purpose, non-infringement, and that the service will be uninterrupted, error-free
          or secure.
        </p>
      </LegalSection>

      <LegalSection {...section("liability")}>
        <p className="uppercase">
          To the fullest extent the law allows, we will not be liable for any indirect, incidental, special, consequential or punitive damages, or for lost profits,
          lost opportunities (including job opportunities) or lost data, arising from your use of {name}. Our total liability for any claim relating to {name} is
          limited to the greater of the amount you paid us in the 12 months before the claim arose, or one hundred US dollars.
        </p>
        <p>Some places don&apos;t allow these limits, so they may not all apply to you. Nothing in these terms limits liability that can&apos;t be limited by law.</p>
      </LegalSection>

      <LegalSection {...section("indemnity")}>
        <p>
          If someone brings a claim against us because of content you submitted or because you broke these terms or the law, you agree to cover our reasonable costs and
          losses from that claim, to the extent the law allows.
        </p>
      </LegalSection>

      <LegalSection {...section("law")}>
        <p>
          These terms are governed by the laws of <CompanyValue value={COMPANY.governingLaw} />, without regard to conflict-of-law rules. Before bringing a formal claim,
          please contact us at <CompanyEmail value={COMPANY.legalEmail} /> so we can try to resolve it informally. Any dispute that can&apos;t be resolved informally will
          be decided by the courts of <CompanyValue value={COMPANY.disputeVenue} />, unless the law where you live gives you the right to bring it elsewhere.
        </p>
        <ReviewNote>Decide whether to use arbitration and a class action waiver instead of courts, and confirm consumer protection carve-outs.</ReviewNote>
      </LegalSection>

      <LegalSection {...section("changes")}>
        <p>
          We may update these terms. If a change is significant, we will tell you by email or in the app at least 30 days before it takes effect. If you keep using{" "}
          {name} after that, the new terms apply; if you don&apos;t agree, you can close your account.
        </p>
      </LegalSection>

      <LegalSection {...section("general")}>
        <p>
          These terms and the Privacy Policy are the whole agreement between you and us about {name}. If any part is found unenforceable, the rest still applies. If we
          don&apos;t enforce a term right away, we can still enforce it later. You can&apos;t transfer your rights under these terms without our permission; we may
          transfer ours as part of a merger, acquisition or sale of our business.
        </p>
      </LegalSection>

      <LegalSection {...section("contact")}>
        <p>
          Questions about these terms: <CompanyEmail value={COMPANY.legalEmail} />. Mail: <CompanyValue value={COMPANY.legalName} />,{" "}
          <CompanyValue value={COMPANY.mailingAddress} />. For help using {name}, visit the{" "}
          <Link href="/help" className="text-primary font-medium hover:underline">
            help center
          </Link>
          .
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
