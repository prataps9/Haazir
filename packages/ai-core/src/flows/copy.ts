import type { ReplyLanguage } from '../language'

type L = Record<ReplyLanguage, string>

/**
 * Words the deterministic flows use (spec §11.5). Button and row titles stay
 * within WhatsApp's limits: 20 characters for buttons, 24 for list rows.
 */
export const FLOW = {
  pickCourse: {
    hinglish: 'Kis course ki free demo class chahiye?',
    hi: 'किस कोर्स की फ्री डेमो क्लास चाहिए?',
    en: 'Which course would you like a free demo class for?',
  },
  pickDay: {
    hinglish: '*{course}* ki demo class kis din aana chahenge?',
    hi: '*{course}* की डेमो क्लास के लिए किस दिन आना चाहेंगे?',
    en: 'Which day would you like to come for the *{course}* demo class?',
  },
  pickSlot: {
    hinglish: '{day} kaunsa time theek rahega?',
    hi: '{day} कौन-सा समय ठीक रहेगा?',
    en: 'Which time suits you {day}?',
  },
  askName: {
    hinglish: 'Student ka naam likh dijiye.',
    hi: 'विद्यार्थी का नाम लिख दीजिए।',
    en: "Please type the student's name.",
  },
  confirm: {
    hinglish:
      'Ek baar dekh lijiye:\n*{course}* free demo\n{when}\nStudent: {name}\nKya book kar doon?',
    hi: 'एक बार देख लीजिए:\n*{course}* फ्री डेमो\n{when}\nविद्यार्थी: {name}\nक्या बुक कर दूँ?',
    en: 'Please check:\n*{course}* free demo\n{when}\nStudent: {name}\nShall I book it?',
  },
  booked: {
    hinglish: 'Hum class se 3 ghante pehle yaad dila denge.',
    hi: 'हम क्लास से 3 घंटे पहले याद दिला देंगे।',
    en: "We'll remind you 3 hours before the class.",
  },
  noSlots: {
    hinglish: 'Abhi koi demo slot khaali nahi hai. Team aapko jald slot batayegi.',
    hi: 'अभी कोई डेमो स्लॉट खाली नहीं है। टीम आपको जल्द स्लॉट बताएगी।',
    en: 'No demo slot is open right now. The team will suggest one shortly.',
  },
  noSlotsThatDay: {
    hinglish: 'Us din demo class nahi hai. Neeche se doosra din chun lijiye.',
    hi: 'उस दिन डेमो क्लास नहीं है। नीचे से दूसरा दिन चुन लीजिए।',
    en: "There's no demo class that day. Please pick another day below.",
  },
  pleaseChoose: {
    hinglish: 'Neeche diye vikalp mein se chun lijiye, ya "rehne do" likhiye.',
    hi: 'नीचे दिए विकल्पों में से चुन लीजिए, या "रहने दो" लिखिए।',
    en: 'Please choose from the options below, or type "cancel".',
  },
  cancelled: {
    hinglish:
      'Theek hai, demo booking rok di. Kabhi bhi "demo" likh kar dobara shuru kar sakte hain.',
    hi: 'ठीक है, डेमो बुकिंग रोक दी। कभी भी "डेमो" लिखकर दोबारा शुरू कर सकते हैं।',
    en: 'Okay, I stopped the demo booking. Type "demo" any time to start again.',
  },
  continuePrompt: {
    hinglish: 'Demo booking jaari rakhein?',
    hi: 'डेमो बुकिंग जारी रखें?',
    en: 'Shall we continue booking the demo?',
  },
  comingThanks: {
    hinglish: 'Badhiya! Milte hain. Pata: {address}',
    hi: 'बढ़िया! मिलते हैं। पता: {address}',
    en: 'Great, see you there! Address: {address}',
  },
  pickCourseToSee: {
    hinglish: 'Ye hamare courses hain. Jis course ki jaankari chahiye, use chuniye.',
    hi: 'ये हमारे कोर्स हैं। जिस कोर्स की जानकारी चाहिए, उसे चुनिए।',
    en: 'These are our courses. Pick one to see the details.',
  },
  noCourses: {
    hinglish: 'Courses ki jaankari team bhejegi.',
    hi: 'कोर्स की जानकारी टीम भेजेगी।',
    en: 'The team will send you the course details.',
  },
  brochureComing: {
    hinglish: '*{course}* ka brochure bhej raha hoon.',
    hi: '*{course}* का ब्रोशर भेज रहा हूँ।',
    en: "Here's the *{course}* brochure.",
  },
  noBrochure: {
    hinglish: '*{course}* ka brochure abhi uplabdh nahi hai. Team bhej degi.',
    hi: '*{course}* का ब्रोशर अभी उपलब्ध नहीं है। टीम भेज देगी।',
    en: "The *{course}* brochure isn't available yet. The team will send it.",
  },
  locationComing: {
    hinglish: 'Hamara pata: {address}',
    hi: 'हमारा पता: {address}',
    en: 'Our address: {address}',
  },
  feeStatus: {
    hinglish: '*{student}* ki agli kisht: *{amount}*, {due} tak ({label}).',
    hi: '*{student}* की अगली किश्त: *{amount}*, {due} तक ({label})।',
    en: "*{student}*'s next installment: *{amount}*, due {due} ({label}).",
  },
  feeLinkComing: {
    hinglish: 'Payment link alag message mein bhej raha hoon.',
    hi: 'भुगतान का लिंक अलग मैसेज में भेज रहा हूँ।',
    en: "I'm sending the payment link in a separate message.",
  },
  feePayAtDesk: {
    hinglish: 'Fees institute ke office mein jama kar sakte hain.',
    hi: 'फीस इंस्टीट्यूट के ऑफ़िस में जमा कर सकते हैं।',
    en: "You can pay the fees at the institute's office.",
  },
  feeAllPaid: {
    hinglish: '*{student}* ki saari fees jama hai. Dhanyavaad!',
    hi: '*{student}* की सारी फीस जमा है। धन्यवाद!',
    en: "All of *{student}*'s fees are paid. Thank you!",
  },
  paymentLink: {
    hinglish: '{student} ki {label} ({amount}) ka payment link: {url}',
    hi: '{student} की {label} ({amount}) का भुगतान लिंक: {url}',
    en: 'Payment link for {student}, {label} ({amount}): {url}',
  },
} satisfies Record<string, L>

export const BUTTON = {
  yesBook: { hinglish: 'Haan, book karo', hi: 'हाँ, बुक करो', en: 'Yes, book it' },
  change: { hinglish: 'Badlo', hi: 'बदलें', en: 'Change' },
  continue: { hinglish: 'Haan, jaari rakho', hi: 'हाँ, जारी रखें', en: 'Yes, continue' },
  cancel: { hinglish: 'Rehne do', hi: 'रहने दो', en: 'Cancel' },
  pickDay: { hinglish: 'Din chunein', hi: 'दिन चुनें', en: 'Pick a day' },
  pickTime: { hinglish: 'Time chunein', hi: 'समय चुनें', en: 'Pick a time' },
  pickCourse: { hinglish: 'Course chunein', hi: 'कोर्स चुनें', en: 'Pick a course' },
  brochure: { hinglish: 'Brochure', hi: 'ब्रोशर', en: 'Brochure' },
} satisfies Record<string, L>

/** "Kal", "Aaj", weekday names: how a person says a day. */
export const DAY_WORD = {
  today: { hinglish: 'Aaj', hi: 'आज', en: 'Today' },
  tomorrow: { hinglish: 'Kal', hi: 'कल', en: 'Tomorrow' },
  dayAfter: { hinglish: 'Parso', hi: 'परसों', en: 'Day after' },
} satisfies Record<string, L>

export const WEEKDAY: Record<ReplyLanguage, Record<string, string>> = {
  hinglish: {
    mon: 'Somvar',
    tue: 'Mangalvar',
    wed: 'Budhvar',
    thu: 'Guruvar',
    fri: 'Shukravar',
    sat: 'Shanivar',
    sun: 'Ravivar',
  },
  hi: {
    mon: 'सोमवार',
    tue: 'मंगलवार',
    wed: 'बुधवार',
    thu: 'गुरुवार',
    fri: 'शुक्रवार',
    sat: 'शनिवार',
    sun: 'रविवार',
  },
  en: {
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
    sat: 'Saturday',
    sun: 'Sunday',
  },
}

/** Replaces {key} placeholders. */
export const fill = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m)
