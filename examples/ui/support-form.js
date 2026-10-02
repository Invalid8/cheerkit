import {
  describeError,
  formatAmount,
  hasSubmission,
  loadContext,
  resumeContribution,
  startContribution,
} from "./support.js";

const feeNotes = {
  owner:
    "Processing fees are covered on our side. You pay exactly the amount you choose.",
  supporter:
    "A processing fee is added at checkout. You will see the final total before you pay.",
  account_default: "Any processing fee is shown at checkout before you pay.",
};

/**
 * Binds a support form (see page.html) to the server. `onCheckout(url)` hands the supporter to Bachs;
 * `onPending()` runs when checkout could not be opened yet and the result page should take over.
 */
export async function mountSupportForm(
  form,
  { api, contextId, metadata, onCheckout, onPending },
) {
  const status = form.querySelector("[data-status]");
  const submit = form.querySelector('button[type="submit"]');
  const currencySelect = form.elements.currency;
  const presets = form.querySelector("[data-presets]");
  const custom = form.elements.custom;
  const range = form.querySelector("[data-range]");
  const say = (text, tone = "info") => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  let context;
  try {
    context = await loadContext(api, contextId);
  } catch (error) {
    say(describeError(error), "error");
    submit.disabled = true;
    return;
  }
  if (!context.acceptingContributions) {
    say(describeError({ code: "context_closed" }), "error");
    submit.disabled = true;
    return;
  }
  form.querySelector("[data-fee-note]").textContent = feeNotes[context.fees];
  for (const field of ["supporterName", "message"]) {
    const collect =
      field === "supporterName" ? context.collectName : context.collectMessage;
    form.querySelector(`[data-field="${field}"]`).hidden = !collect;
  }
  currencySelect.replaceChildren(
    ...context.currencies.map(
      (rules) => new Option(rules.currency, rules.currency),
    ),
  );
  currencySelect.closest("[data-field]").hidden =
    context.currencies.length === 1;

  const rules = () =>
    context.currencies.find((entry) => entry.currency === currencySelect.value);
  const render = () => {
    const current = rules();
    presets.replaceChildren(
      ...current.suggestedAmounts.map((amount, index) => {
        const label = document.createElement("label");
        const input = Object.assign(document.createElement("input"), {
          type: "radio",
          name: "preset",
          value: amount,
          checked: index === 0,
        });
        label.append(input, ` ${formatAmount(amount, current.currency)}`);
        return label;
      }),
    );
    presets.closest("fieldset").hidden = current.suggestedAmounts.length === 0;
    const minimum = formatAmount(current.minimum, current.currency);
    range.textContent = current.maximum
      ? `Any amount from ${minimum} to ${formatAmount(current.maximum, current.currency)}.`
      : `Any amount from ${minimum}.`;
    custom.step = current.fractionDigits
      ? `0.${"0".repeat(current.fractionDigits - 1)}1`
      : "1";
  };
  currencySelect.addEventListener("change", render);
  custom.addEventListener("input", () => {
    for (const preset of presets.querySelectorAll("input"))
      preset.checked = false;
  });
  presets.addEventListener("change", () => {
    custom.value = "";
  });
  render();

  let retrying = false;
  form.addEventListener("input", () => {
    retrying = false;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const amount = custom.value.trim() || new FormData(form).get("preset");
    if (!amount) {
      say("Choose an amount or enter your own.", "error");
      custom.focus();
      return;
    }
    const submission = {
      amount: String(amount),
      currency: currencySelect.value,
    };
    for (const field of ["supporterName", "message"]) {
      const value = form.elements[field]?.value.trim();
      if (value && !form.querySelector(`[data-field="${field}"]`).hidden)
        submission[field] = value;
    }
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    say("Preparing secure checkout…");
    try {
      const access = retrying
        ? await resumeContribution(api)
        : await startContribution(api, contextId, submission, metadata);
      if (access.contribution.checkoutUrl) {
        say("Opening checkout…");
        onCheckout(access.contribution.checkoutUrl);
      } else {
        onPending(access);
      }
    } catch (error) {
      say(describeError(error), "error");
      retrying = error.code === "network" && hasSubmission();
      submit.disabled = false;
    } finally {
      form.removeAttribute("aria-busy");
    }
  });
}
