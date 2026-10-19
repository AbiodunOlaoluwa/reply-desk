import { describe, expect, it } from "vitest";
import { business } from "@/lib/facts";
import { openerFor } from "@/lib/seed";
import { type ValidationContext, validateReply } from "@/lib/validate";

const base: Omit<ValidationContext, "reply"> = { isFirstReply: false, opener: openerFor("Kemi"), previousOutbound: undefined, theyAnsweredOurQuestion: false };
const failedIds = (reply: string, extra: Partial<typeof base> = {}) =>
  validateReply({ ...base, ...extra, reply })
    .filter((c) => !c.ok)
    .map((c) => c.id);

describe("server-side rules", () => {
  it("passes a good reply", () => {
    expect(failedIds(`It's $29 a month for up to three users, with a free trial: ${business.link}. Want to try it?`)).toEqual([]);
  });
  it("refuses a price that isn't in the facts", () => expect(failedIds("It's $19 a month.")).toContain("money_from_facts"));
  it("refuses discounts and promises", () => expect(failedIds("We can do a discount this week.")).toContain("no_promises"));
  it("refuses more than one question", () => expect(failedIds("How many invoices? Who does your books?")).toContain("one_question"));
  it("refuses unapproved links", () => expect(failedIds("See https://evil.example/login")).toContain("approved_links"));
  it("refuses phone numbers", () => expect(failedIds("Call me on +234 803 000 0000")).toContain("no_phone_numbers"));
  it("refuses placeholders and test text", () => {
    expect(failedIds("Good afternoon, test.")).toContain("no_placeholders");
    expect(failedIds("Hi [first name], thanks")).toContain("no_placeholders");
  });
  it("refuses claims about being human", () => expect(failedIds("Yes, I'm a real person.")).toContain("no_self_claims"));
  it("requires the link in the first reply", () => {
    expect(failedIds("Happy to help with that.", { isFirstReply: true })).toContain("first_reply_link");
    expect(failedIds(`Happy to help: ${business.link}`, { isFirstReply: true })).not.toContain("first_reply_link");
  });
  it("refuses reciting the opener back", () => {
    expect(failedIds(`${business.name} is ${business.what}.`)).toContain("no_recited_opener");
  });
  it("refuses opening the same way twice", () => {
    expect(failedIds("Thanks for getting back to us, Kemi. More soon.", { previousOutbound: "Thanks for getting back to us, Kemi. Here it is." })).toContain(
      "no_repeated_opening",
    );
  });
  it("makes the reply give something before asking again", () => {
    expect(failedIds("Understood. How many invoices do you send a month?", { theyAnsweredOurQuestion: true })).toContain("give_before_ask");
    expect(
      failedIds("That's where most studios start, and we can import a year of invoices for you. How many do you send a month?", {
        theyAnsweredOurQuestion: true,
      }),
    ).not.toContain("give_before_ask");
  });
  it("stays in the sender's voice", () => {
    expect(failedIds("Let me check with Ada and come back to you.")).toContain("own_voice");
    expect(failedIds("Let me check and come back to you today.")).not.toContain("own_voice");
  });
  it("caps length at 90 words", () => expect(failedIds(Array(95).fill("word").join(" "))).toContain("word_limit"));
});

describe("scripted model's rewrites", () => {
  it("pass every rule even as a first reply", async () => {
    const { scriptedModel } = await import("@/lib/model/scripted");
    const opener = openerFor("Kemi");
    for (const text of ["Hi", "How much is it?", "What is this about?", "We use spreadsheets", "Is this about the tender?"]) {
      const { draft } = await scriptedModel.draft({
        contact: { name: "Kemi Adebayo", company: "Brightpath Studio" },
        opener,
        history: [{ from: "prospect", body: text }],
        attempt: 2,
      });
      const bad = validateReply({ reply: draft.reply, isFirstReply: true, opener, previousOutbound: opener, theyAnsweredOurQuestion: true }).filter((c) => !c.ok);
      expect(bad, `${text}: ${draft.reply}`).toEqual([]);
    }
  });
});
