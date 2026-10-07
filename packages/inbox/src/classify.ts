/**
 * Built-in email classifier: what a job-related email says about an
 * application. Phrase rules, checked from most to least decisive (a rejection
 * usually also thanks you for interviewing, and "unable to offer you" is not an
 * offer). Confidence follows the Flightpath rule: 90 or more may move a card
 * by itself, anything less is only suggested.
 */
import type { InterviewKind, PostSubmitStage } from "@autoapply/shared";
import { findDateTimes, findDuration, findMeetingLink } from "./dates";
import { stripQuoted } from "./text";
import type { MailMessage } from "./types";

export type EmailKindValue = "CONFIRMATION" | "RESPONSE" | "INTERVIEW" | "OFFER" | "REJECTION";

export const KIND_STAGE: Record<EmailKindValue, PostSubmitStage | null> = {
  CONFIRMATION: null,
  RESPONSE: "RESPONDED",
  INTERVIEW: "INTERVIEWING",
  OFFER: "OFFER",
  REJECTION: "REJECTED",
};

export interface InterviewDetails {
  scheduledAt?: Date;
  durationMinutes?: number;
  location?: string;
  kind?: InterviewKind;
  fromInvite?: boolean;
}

export interface EmailClassification {
  kind: EmailKindValue;
  stage: PostSubmitStage | null;
  confidence: number;
  /** Which rule decided, for tests and debugging. */
  rule: string;
  interview?: InterviewDetails;
  method: "rules" | "ai" | "rules+ai";
}

const REJECTION = [
  /\b(?:decided|chosen|opted) (?:not to|to not) (?:move|proceed|progress|go) (?:forward|ahead)\b/,
  /\b(?:will|won't|will not|are not|aren't|not be|unable to) (?:be )?(?:moving|move|proceed(?:ing)?|progress(?:ing)?) (?:forward|ahead)? ?with your (?:application|candidacy)\b/,
  /\bnot (?:be )?moving forward with your (?:application|candidacy)\b/,
  /\b(?:move|moving|proceed|proceeding|go|going) (?:forward|ahead) with (?:other|another|different) (?:candidates?|applicants?)\b/,
  /\bpursue (?:other|another) (?:candidates?|applicants?)\b/,
  /\b(?:you )?(?:have|has|were|was) not been (?:selected|chosen)\b/,
  /\bnot (?:been )?selected (?:to|for) (?:move forward|proceed|this|the|an interview|further)\b/,
  /\b(?:position|role|opening|requisition|vacancy) (?:has|have) (?:now )?been (?:filled|closed)\b/,
  /\bregret to (?:inform|let you know|tell you)\b/,
  /\bno longer (?:under consideration|being considered|considering your)\b/,
  /\bunable to offer you\b/,
  /\bnot (?:be )?(?:able to )?(?:offer|extend) (?:you )?(?:the|a|an) (?:position|role|offer)\b/,
  /\bwe(?:'ve| have)? decided to go (?:in a different direction|with (?:another|a different) candidate)\b/,
  /\bnot (?:a|the right) (?:fit|match) (?:for this|at this time)\b/,
];
const OFFER = [
  /\b(?:pleased|happy|delighted|excited|thrilled) to (?:formally )?(?:offer you|extend (?:you )?(?:an|the|this) offer)\b/,
  /\bextend(?:ing)? (?:you )?(?:an|a formal|a written|a verbal) offer\b/,
  /\boffer of employment\b/,
  /\byour (?:written |formal )?offer letter\b/,
  /\b(?:attached|enclosed) (?:is |please find )?(?:your |the )?offer\b/,
  /\bcongratulations[^.!\n]{0,80}\boffer\b/,
];
const INTERVIEW_CONFIRMED = [
  /\b(?:invite|invitation|inviting) you (?:to|for) (?:an?|the|your)? ?(?:\w+ )?(?:interview|phone screen|onsite|on-site|video call|technical (?:screen|interview))\b/,
  /\binterview (?:invitation|confirmation|confirmed|scheduled|details)\b/,
  /\byour (?:\w+ )?(?:interview|phone screen|onsite|on-site) (?:is|has been|was) (?:scheduled|confirmed|booked|set|re-?scheduled|moved|cancel(?:l)?ed|postponed)\b/,
  /\b(?:confirm(?:ed|ing)?|scheduled|booked) (?:your|an|the) (?:\w+ )?(?:interview|phone screen|onsite|on-site)\b/,
  /\binvitation: .*\binterview\b/,
];
const INTERVIEW_CHANGED = /\b(?:re-?scheduled|cancel(?:l)?ed|postponed|moved your interview)\b/;
const RESPONSE = [
  /\b(?:like|love|want) to (?:schedule|set up|arrange|book) (?:a|an|some) (?:time|call|chat|conversation|interview|phone screen|meeting)\b/,
  /\b(?:like|love) to (?:learn more about you|chat with you|speak with you|talk with you|connect with you|get to know you)\b/,
  /\b(?:share|send|provide) (?:me |us )?(?:your|a few times of your|some) availability\b/,
  /\bwhat (?:does|is) your availability\b/,
  /\b(?:next step|next steps) (?:in|of) (?:our|the) (?:process|hiring process|interview process)\b/,
  /\b(?:move|moving) (?:you )?forward (?:to|in|with) (?:the )?(?:next|our|your)\b/,
  /\b(?:take-?home|coding|technical) (?:assignment|assessment|challenge|exercise)\b/,
  /\b(?:calendly\.com|goodtime\.io|app\.ashbyhq\.com\/scheduling|greenhouse\.io\/scheduling)\b/,
  /\b(?:your application|your profile|your background|your experience) (?:stood out|caught our attention|impressed)\b/,
];
/** RESPONSE patterns an application-received email also uses. */
const RESPONSE_WEAK = [4, 5];
const CONFIRMATION = [
  /\bthank(?:s| you) for (?:applying|your application|submitting your application)\b/,
  /\b(?:we(?:'ve| have)?|have) received your application\b/,
  /\byour application (?:has been|was) (?:received|submitted)\b/,
  /\bapplication (?:received|confirmation)\b/,
];

const INTERVIEW_KIND_WORDS: Array<[RegExp, InterviewKind]> = [
  [/\bphone screen|screening call|phone interview\b/, "PHONE_SCREEN"],
  [/\brecruiter (?:call|chat|screen|conversation)\b/, "RECRUITER"],
  [/\bhiring manager\b/, "HIRING_MANAGER"],
  [/\btechnical|coding interview|system design|pair programming\b/, "TECHNICAL"],
  [/\bbehavio(?:u)?ral\b/, "BEHAVIORAL"],
  [/\bcase (?:study|interview)\b/, "CASE_STUDY"],
  [/\bpanel\b/, "PANEL"],
  [/\bon-?site\b/, "ONSITE"],
  [/\bfinal (?:round|interview)\b/, "FINAL"],
];

/** "If we decide not to move forward…", "we may invite you to interview": conditions, not news. */
const HEDGE = /\b(?:if|may|might|should|could|once|whether|when|in case|unless)\b[^.!?\n]*$/;

/** Index of the first pattern with a match that isn't hedged, or -1. */
function firstMatch(patterns: RegExp[], text: string) {
  return patterns.findIndex((p) => {
    for (const m of text.matchAll(new RegExp(p.source, "g"))) {
      const before = text.slice(Math.max(0, m.index - 80), m.index);
      if (!HEDGE.test(before)) return true;
    }
    return false;
  });
}

export function interviewKindOf(text: string): InterviewKind | undefined {
  return INTERVIEW_KIND_WORDS.find(([re]) => re.test(text))?.[1];
}

/** Interview time, length and place from the invite, or the text when it names exactly one time. */
export function interviewDetails(message: Pick<MailMessage, "subject" | "text" | "invite" | "receivedAt">, body: string, timeZone: string): InterviewDetails {
  const lower = `${message.subject}\n${body}`.toLowerCase();
  const kind = interviewKindOf(lower);
  if (message.invite) {
    const { start, end, location } = message.invite;
    const minutes = end ? Math.round((end.getTime() - start.getTime()) / 60_000) : null;
    return {
      scheduledAt: start,
      durationMinutes: minutes && minutes > 0 && minutes <= 600 ? minutes : undefined,
      location: findMeetingLink(location ?? "") ?? location ?? findMeetingLink(body) ?? undefined,
      kind,
      fromInvite: true,
    };
  }
  const times = findDateTimes(`${message.subject}\n${body}`, message.receivedAt, timeZone);
  return {
    // Several times means the email offers options; the user picks one.
    scheduledAt: times.length === 1 ? times[0] : undefined,
    durationMinutes: findDuration(body) ?? undefined,
    location: findMeetingLink(body) ?? undefined,
    kind,
  };
}

/**
 * Classify one email. Returns null when it says nothing about an application
 * (most email). `timeZone` is the user's, for times written without a zone.
 */
export function classifyEmail(message: Pick<MailMessage, "subject" | "text" | "invite" | "receivedAt">, timeZone = "UTC"): EmailClassification | null {
  const body = stripQuoted(message.text).slice(0, 8000);
  const subject = message.subject.toLowerCase();
  const text = `${subject}\n${body.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ")}`;

  const result = (kind: EmailKindValue, confidence: number, rule: string, interview?: InterviewDetails): EmailClassification => ({ kind, stage: KIND_STAGE[kind], confidence, rule, interview, method: "rules" });

  const rejection = firstMatch(REJECTION, text);
  if (rejection >= 0) return result("REJECTION", rejection === REJECTION.length - 1 ? 85 : 95, `rejection:${rejection}`);
  if (/\bunfortunately\b/.test(text) && /\b(?:application|candidacy|position|role)\b/.test(text) && !/\b(?:reschedul|interview time|availability)\b/.test(text)) {
    return result("REJECTION", 75, "rejection:unfortunately");
  }

  const offer = firstMatch(OFFER, text);
  if (offer >= 0) return result("OFFER", 93, `offer:${offer}`);

  const confirmed = firstMatch(INTERVIEW_CONFIRMED, text);
  const interviewWord = /\binterview|phone screen|on-?site\b/.test(text);
  if (confirmed >= 0 || (message.invite && interviewWord)) {
    const details = interviewDetails(message, body, timeZone);
    // A changed or cancelled interview needs the user to check the round.
    if (INTERVIEW_CHANGED.test(text)) return result("INTERVIEW", 70, "interview:changed", details);
    return result("INTERVIEW", 93, message.invite ? "interview:invite" : `interview:${confirmed}`, details);
  }

  const response = firstMatch(RESPONSE, text);
  const confirmation = firstMatch(CONFIRMATION, text);
  // "Next steps" in an application-received email describes the process, not a reply.
  const weakResponse = RESPONSE_WEAK.includes(response);
  if (response >= 0 && !(weakResponse && confirmation >= 0)) return result("RESPONSE", weakResponse ? 85 : 90, `response:${response}`);
  // A calendar invite without the word "interview" (a "chat with the team").
  if (message.invite) return result("INTERVIEW", 80, "interview:invite-unlabelled", interviewDetails(message, body, timeZone));

  if (confirmation >= 0) return result("CONFIRMATION", 90, `confirmation:${confirmation}`);
  return null;
}
