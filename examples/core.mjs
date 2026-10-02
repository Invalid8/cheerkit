// Local domain demonstration only: no checkout, persistence, or real payment.
import { createContributionIntent, defineSupportContext } from "cheerkit";

const context = defineSupportContext({
  id: "personal",
  name: "My work",
  collectMessage: true,
  currencies: [
    {
      currency: "NGN",
      fractionDigits: 2,
      minimum: "100",
      maximum: "50000",
      suggestedAmounts: ["1000", "2500", "5000"],
    },
    {
      currency: "USD",
      fractionDigits: 2,
      minimum: "1",
      maximum: "1000",
      suggestedAmounts: ["5", "10", "25"],
    },
  ],
});

const intent = createContributionIntent(
  context,
  { amount: "2500", currency: "NGN", message: "Thanks for your work!" },
  { id: "example-contribution-1", createdAt: new Date().toISOString() },
);

console.log(JSON.stringify(intent, null, 2));
