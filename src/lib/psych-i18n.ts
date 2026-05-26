export type PsychLocale = "en" | "ml";

/**
 * Bilingual UI string dictionary used by the public test interface
 * and the (small set of) bilingual error pages. Question text itself
 * lives on PsychQuestion.textEn / textMl.
 */
export const dict = {
  test: {
    title: { en: "Personality Assessment", ml: "വ്യക്തിത്വ വിലയിരുത്തൽ" },
    welcome: { en: "Welcome", ml: "സ്വാഗതം" },
    hello: { en: "Hello", ml: "നമസ്കാരം" },
    estimated: {
      en: "Estimated time: 15–20 minutes",
      ml: "ഏകദേശ സമയം: 15–20 മിനിറ്റ്",
    },
    instructions: {
      en: "Please answer each statement honestly. There are no right or wrong answers. Choose the response that best describes how you usually think, feel, or behave.",
      ml: "ഓരോ പ്രസ്താവനയും സത്യസന്ധമായി ഉത്തരം നൽകുക. ശരിയോ തെറ്റോ ആയ ഉത്തരങ്ങളില്ല. നിങ്ങൾ സാധാരണയായി ചിന്തിക്കുന്ന, അനുഭവിക്കുന്ന, അല്ലെങ്കിൽ പെരുമാറുന്ന രീതി ഏറ്റവും നന്നായി വിവരിക്കുന്ന ഉത്തരം തിരഞ്ഞെടുക്കുക.",
    },
    consent: {
      en: "I agree to complete this assessment honestly.",
      ml: "ഞാൻ ഈ വിലയിരുത്തൽ സത്യസന്ധമായി പൂർത്തിയാക്കാൻ സമ്മതിക്കുന്നു.",
    },
    start: { en: "Start assessment", ml: "വിലയിരുത്തൽ ആരംഭിക്കുക" },
    next: { en: "Next", ml: "അടുത്തത്" },
    back: { en: "Back", ml: "മുമ്പത്തേത്" },
    submit: { en: "Submit", ml: "സമർപ്പിക്കുക" },
    review: { en: "Review answers", ml: "ഉത്തരങ്ങൾ പരിശോധിക്കുക" },
    edit: { en: "Edit", ml: "എഡിറ്റ് ചെയ്യുക" },
    answer_all: {
      en: "Please answer every question on this page before continuing.",
      ml: "തുടരുന്നതിന് മുമ്പ് ഈ പേജിലെ എല്ലാ ചോദ്യങ്ങൾക്കും ഉത്തരം നൽകുക.",
    },
    confirm_submit_title: {
      en: "Submit your answers?",
      ml: "നിങ്ങളുടെ ഉത്തരങ്ങൾ സമർപ്പിക്കണോ?",
    },
    confirm_submit_body: {
      en: "Once submitted, you cannot retake this assessment. Are you sure you want to submit?",
      ml: "സമർപ്പിച്ചാൽ പിന്നെ ഈ വിലയിരുത്തൽ വീണ്ടും എടുക്കാൻ കഴിയില്ല. തീർച്ചയായും സമർപ്പിക്കണോ?",
    },
    confirm_yes: { en: "Yes, submit", ml: "അതെ, സമർപ്പിക്കുക" },
    cancel: { en: "Cancel", ml: "റദ്ദാക്കുക" },
    thank_you_title: { en: "Thank you!", ml: "നന്ദി!" },
    thank_you_body: {
      en: "Your responses have been recorded. You may close this window. HR will be in touch if needed.",
      ml: "നിങ്ങളുടെ ഉത്തരങ്ങൾ രേഖപ്പെടുത്തി. ഈ വിൻഡോ അടയ്ക്കാം. ആവശ്യമെങ്കിൽ HR ബന്ധപ്പെടും.",
    },
    progress: {
      en: "Question {{current}} of {{total}}",
      ml: "ചോദ്യം {{current}} / {{total}}",
    },
    translation_pending: {
      en: "Malayalam translation pending — English shown.",
      ml: "മലയാള പരിഭാഷ ലഭ്യമല്ല — ഇംഗ്ലീഷിൽ കാണിക്കുന്നു.",
    },
    likert: {
      1: { en: "Strongly Disagree", ml: "ശക്തമായി വിയോജിക്കുന്നു" },
      2: { en: "Disagree", ml: "വിയോജിക്കുന്നു" },
      3: { en: "Neutral", ml: "നിഷ്പക്ഷം" },
      4: { en: "Agree", ml: "യോജിക്കുന്നു" },
      5: { en: "Strongly Agree", ml: "ശക്തമായി യോജിക്കുന്നു" },
    },
  },
  errors: {
    expired_title: {
      en: "This link has expired",
      ml: "ഈ ലിങ്ക് കാലഹരണപ്പെട്ടു",
    },
    expired_body: {
      en: "Please contact HR for a new assessment link.",
      ml: "പുതിയ വിലയിരുത്തൽ ലിങ്കിനായി HR-മായി ബന്ധപ്പെടുക.",
    },
    completed_title: {
      en: "Assessment already completed",
      ml: "വിലയിരുത്തൽ ഇതിനകം പൂർത്തിയാക്കി",
    },
    completed_body: {
      en: "You have already submitted this assessment. Thank you for your responses.",
      ml: "നിങ്ങൾ ഈ വിലയിരുത്തൽ ഇതിനകം സമർപ്പിച്ചു. ഉത്തരങ്ങൾക്ക് നന്ദി.",
    },
    rate_limit_title: { en: "Too many attempts", ml: "വളരെയധികം ശ്രമങ്ങൾ" },
    rate_limit_body: {
      en: "You have opened this link too many times in a short period. Please wait and try again later.",
      ml: "ഈ ലിങ്ക് കുറഞ്ഞ സമയത്തിനുള്ളിൽ വളരെയധികം തവണ തുറന്നു. ദയവായി കാത്തിരുന്ന് വീണ്ടും ശ്രമിക്കുക.",
    },
    invalidated_title: {
      en: "This link is no longer valid",
      ml: "ഈ ലിങ്ക് ഇനി സാധുവല്ല",
    },
    invalidated_body: {
      en: "HR has issued a new assessment link. Please use the most recent link sent to you.",
      ml: "HR പുതിയ വിലയിരുത്തൽ ലിങ്ക് നൽകിയിട്ടുണ്ട്. നിങ്ങൾക്ക് അയച്ച ഏറ്റവും പുതിയ ലിങ്ക് ഉപയോഗിക്കുക.",
    },
  },
} as const;

export type DictNode = { en: string; ml: string };

export function t(node: DictNode, locale: PsychLocale, vars?: Record<string, string | number>): string {
  let s = node[locale];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{${k}}}`, "g"), String(v));
    }
  }
  return s;
}

export function detectLocale(headerOrNavigator: string | undefined): PsychLocale {
  if (!headerOrNavigator) return "en";
  return /^ml\b/i.test(headerOrNavigator) ? "ml" : "en";
}
