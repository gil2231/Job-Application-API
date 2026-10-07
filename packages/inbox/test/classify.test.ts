import { describe, expect, it } from "vitest";
import { classifyEmail, findDateTimes, findDuration, findMeetingLink, htmlToText, parseIcs, stripQuoted, zonedToUtc } from "../src";

const received = new Date("2026-10-06T15:00:00Z");
const email = (subject: string, text: string, invite: Parameters<typeof classifyEmail>[0]["invite"] = null) => ({ subject, text, invite, receivedAt: received });
const kindOf = (subject: string, text: string) => {
  const r = classifyEmail(email(subject, text), "America/New_York");
  return r ? { kind: r.kind, stage: r.stage, confident: r.confidence >= 90 } : null;
};

describe("classifyEmail", () => {
  it("reads common rejections as confident", () => {
    const samples = [
      "Thank you for your interest in the Account Executive role at Acme. After careful consideration, we have decided not to move forward with your application.",
      "Unfortunately, we will not be moving forward with your candidacy at this time.",
      "We've decided to move forward with other candidates whose experience more closely matches our needs.",
      "We regret to inform you that the position has been filled.",
      "Thank you for interviewing with us. You have not been selected for the next round.",
      "Thanks for applying. We’ve decided to pursue other candidates for this role.",
    ];
    for (const text of samples) expect(kindOf("Your application to Acme", text), text).toEqual({ kind: "REJECTION", stage: "REJECTED", confident: true });
  });

  it("doesn't read a conditional as news", () => {
    const text = "Thanks for applying to Acme! Our team reviews every application. If we decide not to move forward with your application, we'll let you know by email. If your experience matches, we may invite you to an interview.";
    expect(kindOf("Thanks for applying to Acme", text)).toEqual({ kind: "CONFIRMATION", stage: null, confident: true });
  });

  it("treats a vague 'unfortunately' as a suggestion only", () => {
    expect(kindOf("Update on your application", "Unfortunately the role you applied for is on hold for now.")).toEqual({ kind: "REJECTION", stage: "REJECTED", confident: false });
    expect(kindOf("Interview time", "Unfortunately I need to reschedule our interview time, what is your availability?")?.kind).not.toBe("REJECTION");
  });

  it("reads offers, and doesn't mistake 'unable to offer you' for one", () => {
    expect(kindOf("Offer from Acme", "We're delighted to offer you the position of Account Executive. Your offer letter is attached.")).toEqual({ kind: "OFFER", stage: "OFFER", confident: true });
    expect(kindOf("Acme update", "We were impressed, but we're unable to offer you the role at this time.")?.kind).toBe("REJECTION");
    expect(kindOf("Benefits", "We offer competitive benefits and equity to every employee.")).toBeNull();
  });

  it("reads a confirmed interview with its time, length, kind and link", () => {
    const r = classifyEmail(
      email(
        "Interview confirmation: Acme",
        "Hi Sam,\n\nYour phone screen is confirmed for Tuesday, October 14 at 2:30 PM ET. It's a 30-minute call with Priya.\nJoin: https://acme.zoom.us/j/123456789?pwd=abc\n\nBest,\nRecruiting",
      ),
      "America/Los_Angeles",
    )!;
    expect(r).toMatchObject({ kind: "INTERVIEW", stage: "INTERVIEWING", confidence: 93 });
    expect(r.interview).toEqual({
      scheduledAt: new Date("2026-10-14T18:30:00Z"),
      durationMinutes: 30,
      location: "https://acme.zoom.us/j/123456789?pwd=abc",
      kind: "PHONE_SCREEN",
    });
  });

  it("uses the user's time zone for times without one, and leaves offered options for the user", () => {
    const one = classifyEmail(email("Interview invitation", "We'd like to invite you to a technical interview on Oct 20 at 10:00 am."), "America/Chicago")!;
    expect(one.interview?.scheduledAt).toEqual(new Date("2026-10-20T15:00:00Z"));
    expect(one.interview?.kind).toBe("TECHNICAL");
    const options = classifyEmail(email("Interview invitation", "We'd like to invite you to an interview. Would October 20 at 10:00 AM or October 21 at 3:00 PM work?"), "UTC")!;
    expect(options.kind).toBe("INTERVIEW");
    expect(options.interview?.scheduledAt).toBeUndefined();
  });

  it("reads a calendar invite as an interview that is already on the calendar", () => {
    const invite = { start: new Date("2026-10-15T16:00:00Z"), end: new Date("2026-10-15T16:45:00Z"), location: "https://meet.google.com/abc-defg-hij", summary: "Acme interview" };
    const r = classifyEmail(email("Invitation: Acme interview @ Wed Oct 15", "You have been invited to the following event: Acme <> Sam interview", invite))!;
    expect(r).toMatchObject({ kind: "INTERVIEW", confidence: 93, interview: { scheduledAt: invite.start, durationMinutes: 45, location: invite.location, fromInvite: true } });
  });

  it("only suggests a rescheduled or cancelled interview", () => {
    expect(kindOf("Interview rescheduled", "Your interview has been rescheduled to October 16 at 1:00 PM ET.")).toEqual({ kind: "INTERVIEW", stage: "INTERVIEWING", confident: false });
  });

  it("reads scheduling requests and assessments as a response", () => {
    expect(kindOf("Acme / Sam", "Hi Sam, thanks for applying! I'd love to schedule a call to learn more. What is your availability next week?")).toEqual({ kind: "RESPONSE", stage: "RESPONDED", confident: true });
    expect(kindOf("Next step: coding assessment", "Please complete the coding assessment within 5 days.")).toEqual({ kind: "RESPONSE", stage: "RESPONDED", confident: true });
  });

  it("keeps an application-received email that mentions next steps a confirmation", () => {
    expect(kindOf("We received your application", "Thank you for applying! We have received your application and will be in touch about next steps in our process.")?.kind).toBe("CONFIRMATION");
  });

  it("ignores unrelated email and quoted history", () => {
    expect(kindOf("Lunch?", "Want to grab lunch on Friday?")).toBeNull();
    expect(kindOf("Re: lunch", "Sounds good!\n\nOn Mon, Oct 5, 2026 at 9:00 AM Recruiter <r@acme.com> wrote:\n> We have decided not to move forward with your application.")).toBeNull();
  });
});

describe("dates", () => {
  it("finds one time in common formats", () => {
    const at = (text: string, zone = "UTC") => findDateTimes(text, received, zone).map((d) => d.toISOString());
    expect(at("Tuesday, October 14 at 2:00 PM PT")).toEqual(["2026-10-14T21:00:00.000Z"]);
    expect(at("on 14 October 2026 at 14:30", "Europe/London")).toEqual(["2026-10-14T13:30:00.000Z"]);
    expect(at("Oct. 7th, 9am EST")).toEqual(["2026-10-07T13:00:00.000Z"]);
    expect(at("10/14 at 3:15 pm", "America/New_York")).toEqual(["2026-10-14T19:15:00.000Z"]);
    // A January date seen in October is next year's.
    expect(at("January 8 at 11:00 AM")).toEqual(["2027-01-08T11:00:00.000Z"]);
  });

  it("ignores vague or implausible times", () => {
    expect(findDateTimes("October 14 at 2", received, "UTC")).toEqual([]);
    expect(findDateTimes("Founded March 3, 2011 at 10:00 AM", received, "UTC")).toEqual([]);
  });

  it("reads duration and meeting links", () => {
    expect(findDuration("a 45-minute conversation")).toBe(45);
    expect(findDuration("about an hour")).toBe(60);
    expect(findMeetingLink("join https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0 today")).toBe("https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0");
  });

  it("converts wall-clock time in a zone, across daylight time", () => {
    expect(zonedToUtc(2026, 7, 1, 9, 0, "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedToUtc(2026, 12, 1, 9, 0, "America/New_York").toISOString()).toBe("2026-12-01T14:00:00.000Z");
  });
});

describe("parseIcs", () => {
  it("reads the event, with a TZID and folded lines", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "DTSTART;TZID=America/New_York:20261015T100000",
      "DTEND;TZID=America/New_York:20261015T104500",
      "SUMMARY:Acme interview",
      "LOCATION:https://meet.google.com/abc-defg-hij\\, or call +1 555",
      " 0100",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    expect(parseIcs(ics)).toEqual({
      start: new Date("2026-10-15T14:00:00Z"),
      end: new Date("2026-10-15T14:45:00Z"),
      location: "https://meet.google.com/abc-defg-hij, or call +1 5550100",
      summary: "Acme interview",
    });
    expect(parseIcs("BEGIN:VCALENDAR\nMETHOD:CANCEL\nBEGIN:VEVENT\nDTSTART:20261015T140000Z\nEND:VEVENT")).toBeNull();
  });
});

describe("text", () => {
  it("turns HTML into text and drops quoted replies", () => {
    expect(htmlToText("<p>Hi&nbsp;Sam,</p><p>We&#39;re <b>excited</b></p><style>p{}</style>")).toBe("Hi Sam,\nWe're excited");
    expect(stripQuoted("Thanks!\n> old line\nmore")).toBe("Thanks!\nmore");
  });
});
