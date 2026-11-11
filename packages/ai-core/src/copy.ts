import type { Localised } from '@haazir/db'
import type { ReplyLanguage } from './language'

/**
 * Fixed messages the bot sends without an LLM (spec §11.1, §11.6). Owners
 * will be able to edit the texts (Phase 3); the structure stays in code.
 */
export const COPY = {
  handoff: {
    hinglish: 'Main aapki baat team se karwa raha hoon. Thodi der mein jawab milega.',
    hi: 'मैं आपकी बात टीम से करवा रहा हूँ। थोड़ी देर में जवाब मिलेगा।',
    en: "I'm connecting you with our team. You'll get a reply shortly.",
  },
  afterHours: {
    hinglish: 'Abhi institute band hai. Team {when} jawab degi.',
    hi: 'अभी इंस्टीट्यूट बंद है। टीम {when} जवाब देगी।',
    en: 'The institute is closed right now. The team will reply {when}.',
  },
  photo: {
    hinglish: 'Photo mil gayi, team dekh kar reply karegi.',
    hi: 'फ़ोटो मिल गई, टीम देखकर जवाब देगी।',
    en: 'Got your photo. The team will look at it and reply.',
  },
  file: {
    hinglish: 'File mil gayi, team dekh kar reply karegi.',
    hi: 'फ़ाइल मिल गई, टीम देखकर जवाब देगी।',
    en: 'Got your file. The team will look at it and reply.',
  },
  voiceUnclear: {
    hinglish: 'Voice note mil gaya. Team sun kar reply karegi.',
    hi: 'वॉइस नोट मिल गया। टीम सुनकर जवाब देगी।',
    en: 'Got your voice note. The team will listen and reply.',
  },
  optOut: {
    hinglish: 'Theek hai ji, ab hum aapko message nahi bhejenge.',
    hi: 'ठीक है जी, अब हम आपको मैसेज नहीं भेजेंगे।',
    en: "Okay, we won't message you again.",
  },
  clarify: {
    hinglish: 'Maaf kijiye, main samajh nahi paaya. Aap kis baare mein jaanna chahte hain?',
    hi: 'माफ़ कीजिए, मैं समझ नहीं पाया। आप किस बारे में जानना चाहते हैं?',
    en: "Sorry, I didn't quite get that. What would you like to know?",
  },
  /** Added to a normal reply when the institute is closed (the bot itself is always there). */
  closedNow: {
    hinglish: 'Abhi institute band hai, {when} khulega. Tab tak aap mujhse pooch sakte hain.',
    hi: 'अभी इंस्टीट्यूट बंद है, {when} खुलेगा। तब तक आप मुझसे पूछ सकते हैं।',
    en: 'The institute is closed right now and opens {when}. You can keep asking me here.',
  },
  optInAsk: {
    hinglish:
      'Naye batch aur offers ki jaankari WhatsApp par bhejein? Jab chahein STOP likh kar band kar sakte hain.',
    hi: 'नए बैच और ऑफ़र की जानकारी WhatsApp पर भेजें? जब चाहें STOP लिखकर बंद कर सकते हैं।',
    en: 'May we send you news of new batches and offers on WhatsApp? You can stop them any time by writing STOP.',
  },
  optInYes: { hinglish: 'Haan, bhejein', hi: 'हाँ, भेजें', en: 'Yes, send them' },
  optInNo: { hinglish: 'Nahi', hi: 'नहीं', en: 'No' },
  optedIn: {
    hinglish:
      'Theek hai ji, naye batch aur offers ki jaankari aapko bhejenge. Band karne ke liye STOP likhein.',
    hi: 'ठीक है जी, नए बैच और ऑफ़र की जानकारी आपको भेजेंगे। बंद करने के लिए STOP लिखें।',
    en: "Done. We'll send you news of new batches and offers. Write STOP to end them.",
  },
  optInDeclined: {
    hinglish: 'Theek hai ji, hum sirf aapke sawaalon ke jawab denge.',
    hi: 'ठीक है जी, हम सिर्फ़ आपके सवालों के जवाब देंगे।',
    en: "No problem. We'll only answer your questions.",
  },
  privacy: {
    hinglish: 'Aapki jaankari kaise rakhi jaati hai:',
    hi: 'आपकी जानकारी कैसे रखी जाती है:',
    en: 'How we keep your information:',
  },
  demo: { hinglish: 'Free demo', hi: 'फ्री डेमो', en: 'Free demo' },
  talk: { hinglish: 'Baat karein', hi: 'बात करें', en: 'Talk to us' },
  courses: { hinglish: 'Courses dekhein', hi: 'कोर्स देखें', en: 'See courses' },
} satisfies Record<string, Record<ReplyLanguage, string>>

/** Owner-edited text if there is one for this language, else our default. */
export function pick(
  custom: Localised | undefined,
  fallback: Record<ReplyLanguage, string>,
  lang: ReplyLanguage,
) {
  return custom?.[lang] || custom?.hinglish || fallback[lang]
}
