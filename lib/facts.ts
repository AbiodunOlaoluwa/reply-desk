// The fictional business this demo answers for. The assistant may state these facts and nothing else.
export const business = {
  name: "Tallyhouse",
  what: "bookkeeping software for small agencies and studios. It keeps invoices, expenses and monthly reports in one place",
  benefit: "month-end takes an hour instead of a weekend",
  link: "https://tallyhouse.example",
  trial: "a 14-day free trial, no card needed",
  price: "$29 a month for up to three users",
  setup: "we import your last 12 months of invoices so you don't start from scratch",
  operator: "Ada",
  operatorFull: "Ada Okafor",
};

// Money the assistant is allowed to mention. Anything else is refused by the server.
export const allowedAmounts = ["$29"];

// Links the assistant is allowed to send.
export const allowedLinks = [business.link];

// What the server sends, word for word, when someone asks whether they are talking to a bot.
export const disclosureText = `This is ${business.name}'s automated assistant, helping ${business.operator} with replies. I'll pass you to ${business.operator} now.`;

export const factSheet = `
Business: ${business.name} (fictional)
What it is: ${business.what}.
Why it helps: ${business.benefit}.
Link: ${business.link}
Trial: ${business.trial}.
Price: ${business.price}.
Setup: ${business.setup}.
Person who takes over conversations: ${business.operatorFull} (call her ${business.operator}).
`.trim();
