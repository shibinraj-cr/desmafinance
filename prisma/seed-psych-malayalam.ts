/**
 * Populate Malayalam translations on the seeded IPIP-50 + 3 validity
 * items. Matches each row by `textEn` and updates `textMl` only when
 * it's currently null.
 *
 * Caveat: these are best-effort translations. The IPIP-50 was
 * validated in English; please have a native Malayalam reviewer
 * sanity-check the wording before using results for performance
 * decisions.
 *
 * Run with:  npx tsx prisma/seed-psych-malayalam.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const translations: Array<{ en: string; ml: string }> = [
  // Openness
  { en: "I have a vivid imagination.", ml: "എനിക്ക് സജീവമായ ഭാവനയുണ്ട്." },
  { en: "I have a rich vocabulary.", ml: "എനിക്ക് വിശാലമായ പദസമ്പത്തുണ്ട്." },
  { en: "I have excellent ideas.", ml: "എനിക്ക് മികച്ച ആശയങ്ങളുണ്ട്." },
  { en: "I am quick to understand things.", ml: "ഞാൻ കാര്യങ്ങൾ വേഗത്തിൽ മനസ്സിലാക്കും." },
  { en: "I use difficult words.", ml: "ഞാൻ കടുപ്പമുള്ള വാക്കുകൾ ഉപയോഗിക്കാറുണ്ട്." },
  { en: "I spend time reflecting on things.", ml: "കാര്യങ്ങളെക്കുറിച്ച് ചിന്തിക്കാൻ ഞാൻ സമയം ചെലവഴിക്കാറുണ്ട്." },
  { en: "I am full of ideas.", ml: "ഞാൻ ആശയങ്ങൾ നിറഞ്ഞ ആളാണ്." },
  { en: "I have difficulty understanding abstract ideas.", ml: "അമൂർത്തമായ ആശയങ്ങൾ മനസ്സിലാക്കാൻ എനിക്ക് ബുദ്ധിമുട്ടാണ്." },
  { en: "I am not interested in abstract ideas.", ml: "അമൂർത്തമായ ആശയങ്ങളിൽ എനിക്ക് താൽപ്പര്യമില്ല." },
  { en: "I do not have a good imagination.", ml: "എനിക്ക് നല്ല ഭാവനയില്ല." },

  // Conscientiousness
  { en: "I am always prepared.", ml: "ഞാൻ എപ്പോഴും തയ്യാറാണ്." },
  { en: "I pay attention to details.", ml: "ഞാൻ വിശദാംശങ്ങൾക്ക് ശ്രദ്ധ നൽകുന്നു." },
  { en: "I get chores done right away.", ml: "ജോലികൾ ഞാൻ ഉടനെ പൂർത്തിയാക്കും." },
  { en: "I like order.", ml: "എനിക്ക് ക്രമം ഇഷ്ടമാണ്." },
  { en: "I follow a schedule.", ml: "ഞാൻ ഒരു സമയക്രമം പിന്തുടരാറുണ്ട്." },
  { en: "I am exacting in my work.", ml: "എന്റെ ജോലിയിൽ ഞാൻ കൃത്യത പുലർത്തുന്നു." },
  { en: "I leave my belongings around.", ml: "ഞാൻ എന്റെ സാധനങ്ങൾ എവിടെയും ഇട്ടുവിടാറുണ്ട്." },
  { en: "I make a mess of things.", ml: "ഞാൻ കാര്യങ്ങൾ താറുമാറാക്കാറുണ്ട്." },
  { en: "I often forget to put things back in their proper place.", ml: "സാധനങ്ങൾ ശരിയായ സ്ഥാനത്ത് തിരികെ വയ്ക്കാൻ ഞാൻ പലപ്പോഴും മറക്കാറുണ്ട്." },
  { en: "I shirk my duties.", ml: "ഞാൻ എന്റെ കടമകൾ ഒഴിവാക്കാറുണ്ട്." },

  // Extraversion
  { en: "I am the life of the party.", ml: "ഞാൻ പാർട്ടിയുടെ ജീവനാണ്." },
  { en: "I feel comfortable around people.", ml: "ആളുകൾക്കിടയിൽ എനിക്ക് സുഖമായി തോന്നുന്നു." },
  { en: "I start conversations.", ml: "ഞാൻ സംഭാഷണങ്ങൾ ആരംഭിക്കാറുണ്ട്." },
  { en: "I talk to a lot of different people at parties.", ml: "പാർട്ടികളിൽ ഞാൻ വ്യത്യസ്തരായ പലരോടും സംസാരിക്കാറുണ്ട്." },
  { en: "I don't mind being the centre of attention.", ml: "ശ്രദ്ധാകേന്ദ്രമാകുന്നതിൽ എനിക്ക് കുഴപ്പമില്ല." },
  { en: "I don't talk a lot.", ml: "ഞാൻ അധികം സംസാരിക്കാറില്ല." },
  { en: "I keep in the background.", ml: "ഞാൻ പിന്നണിയിൽ നിൽക്കാൻ ഇഷ്ടപ്പെടുന്നു." },
  { en: "I have little to say.", ml: "എനിക്ക് പറയാൻ കുറച്ചേ ഉള്ളു." },
  { en: "I don't like to draw attention to myself.", ml: "എന്നിലേക്ക് ശ്രദ്ധ ആകർഷിക്കാൻ എനിക്ക് ഇഷ്ടമല്ല." },
  { en: "I am quiet around strangers.", ml: "അപരിചിതർക്കിടയിൽ ഞാൻ ശാന്തനായിരിക്കും." },

  // Agreeableness
  { en: "I am interested in people.", ml: "എനിക്ക് ആളുകളിൽ താൽപ്പര്യമുണ്ട്." },
  { en: "I sympathise with others' feelings.", ml: "മറ്റുള്ളവരുടെ വികാരങ്ങളോട് ഞാൻ സഹതാപം കാണിക്കാറുണ്ട്." },
  { en: "I have a soft heart.", ml: "എനിക്ക് മൃദുവായ ഹൃദയമാണ്." },
  { en: "I take time out for others.", ml: "ഞാൻ മറ്റുള്ളവർക്കായി സമയം മാറ്റിവയ്ക്കാറുണ്ട്." },
  { en: "I feel others' emotions.", ml: "ഞാൻ മറ്റുള്ളവരുടെ വികാരങ്ങൾ അനുഭവിക്കാറുണ്ട്." },
  { en: "I make people feel at ease.", ml: "ഞാൻ ആളുകൾക്ക് സുഖകരമായ അനുഭവം നൽകാറുണ്ട്." },
  { en: "I am not really interested in others.", ml: "മറ്റുള്ളവരിൽ എനിക്ക് ശരിക്കും താൽപ്പര്യമില്ല." },
  { en: "I insult people.", ml: "ഞാൻ ആളുകളെ അപമാനിക്കാറുണ്ട്." },
  { en: "I am not interested in other people's problems.", ml: "മറ്റുള്ളവരുടെ പ്രശ്നങ്ങളിൽ എനിക്ക് താൽപ്പര്യമില്ല." },
  { en: "I feel little concern for others.", ml: "മറ്റുള്ളവരെക്കുറിച്ച് എനിക്ക് ചെറിയ ആശങ്ക മാത്രമേ ഉള്ളൂ." },

  // Neuroticism
  { en: "I get stressed out easily.", ml: "ഞാൻ പെട്ടെന്ന് സമ്മർദ്ദത്തിലാകുന്നു." },
  { en: "I worry about things.", ml: "ഞാൻ കാര്യങ്ങളെക്കുറിച്ച് ആകുലപ്പെടാറുണ്ട്." },
  { en: "I am easily disturbed.", ml: "ഞാൻ പെട്ടെന്ന് അലോസരപ്പെടും." },
  { en: "I get upset easily.", ml: "ഞാൻ പെട്ടെന്ന് വിഷമിക്കും." },
  { en: "I change my mood a lot.", ml: "എന്റെ മാനസികാവസ്ഥ ഞാൻ കൂടെക്കൂടെ മാറ്റാറുണ്ട്." },
  { en: "I have frequent mood swings.", ml: "എനിക്ക് ഇടയ്ക്കിടെ മാനസിക ചാഞ്ചാട്ടം ഉണ്ടാകാറുണ്ട്." },
  { en: "I get irritated easily.", ml: "ഞാൻ പെട്ടെന്ന് ദേഷ്യപ്പെടും." },
  { en: "I often feel blue.", ml: "ഞാൻ പലപ്പോഴും വിഷാദത്തിലായിരിക്കും." },
  { en: "I am relaxed most of the time.", ml: "ഞാൻ കൂടുതൽ സമയവും ശാന്തനായിരിക്കും." },
  { en: "I seldom feel blue.", ml: "ഞാൻ അപൂർവമായി മാത്രമേ വിഷാദത്തിലാകൂ." },

  // Validity items
  { en: "I tend to be prepared ahead of time.", ml: "ഞാൻ പൊതുവെ സമയത്തിന് മുമ്പേ തയ്യാറാകാറുണ്ട്." },
  { en: "I am at ease when meeting new people.", ml: "പുതിയ ആളുകളെ കാണുമ്പോൾ എനിക്ക് സുഖമായി തോന്നുന്നു." },
  { en: "I take notice when others are upset.", ml: "മറ്റുള്ളവർ വിഷമത്തിലാകുമ്പോൾ ഞാൻ ശ്രദ്ധിക്കാറുണ്ട്." },
];

async function main() {
  let updated = 0;
  let missing = 0;
  for (const { en, ml } of translations) {
    const result = await prisma.psychQuestion.updateMany({
      where: { textEn: en },
      data: { textMl: ml },
    });
    if (result.count === 0) {
      console.warn(`(no match for) ${en}`);
      missing++;
    } else {
      updated += result.count;
    }
  }
  console.log(`Updated ${updated} questions. Missed: ${missing}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
