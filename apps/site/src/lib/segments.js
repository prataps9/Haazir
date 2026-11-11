/**
 * Outreach variants. Each one is a real page — /jewellers, /clinics, /hotels,
 * /coaching — so a link you paste into a chat talks about that person's counter
 * instead of a generic "business".
 *
 * Everything brand-level (the wordmark, the headline, the palette) stays fixed.
 * What changes is the subhead, the thread the hero plays, the paragraph that
 * opens the marketing section, and what the calculator opens tuned to.
 *
 * `thread` is the scripted exchange the hero plays out. Each one
 * is written to end the same way on purpose: the agent answers, books, and then
 * hits something it should not decide — a discount, a diagnosis, a rate — and
 * hands over. That hand-off is the part that earns trust, so it is the part the
 * demo finishes on.
 */

export const DEFAULT_SEGMENT = {
  slug: '',
  /** Shown in <title> and the OG card. */
  name: 'premium Indian businesses',
  /** How the prospect refers to their own place, used inside WhatsApp messages. */
  noun: 'business',
  marketing:
    "Every enquiry is saved as a lead. People who booked get a reminder before the visit, and people who agreed to hear from you get your next offer, on the same number.",
  subhead:
    'Your customer messages at 11pm on a Sunday. haazir answers in the language they wrote in, books them the slot they asked for, and hands the thread to your team the moment it needs a person.',
  /** The sample exchange in the hero card. */
  chat: {
    time: '11:42 pm',
    from: 'Is the Kundan set still available?',
    reply: "Ji haan — it's in the Johari Bazaar store. Shall I hold it for you till tomorrow 6pm?",
  },
  /** Calculator starting point — a plausible mid-size operation. */
  calculator: { enquiries: 45, ticket: 35_000 },
  thread: {
    opened: '11:42 pm, Sunday',
    messages: [
      { who: 'them', text: 'Is the Kundan set still available?' },
      {
        who: 'agent',
        text: "Ji haan — it's in the Johari Bazaar store. Shall I hold it for you till tomorrow 6pm?",
      },
      { who: 'them', text: 'Haan rakh dijiye. Kitne ka hai?' },
      {
        who: 'agent',
        text: 'The set is ₹1,84,000 with the matching earrings. Held under your name till 6pm tomorrow.',
      },
      { who: 'them', text: 'Thoda kam ho sakta hai?' },
      {
        who: 'agent',
        text: "That one's not mine to decide — I'm putting Rajesh from the store on it now. He'll message you in the morning.",
      },
    ],
    handover: 'Handed to a human at 11:44 pm',
  },
}

export const SEGMENTS = [
  {
    slug: 'jewellers',
    name: 'jewellery showrooms',
    noun: 'jewellery showroom',
    marketing:
      "Every enquiry is saved as a lead. The customer who asked about a set gets a reminder before the viewing, and those who agreed to hear from you get the festive collection on the same number.",
    subhead:
      'A customer asks about a set at 11pm on a Sunday. haazir answers in the language they wrote in, holds the piece, books the viewing — and hands the thread to your counter staff the moment it turns into a negotiation.',
    chat: {
      time: '11:42 pm',
      from: 'Is the Kundan set still available?',
      reply: "Ji haan — it's in the Johari Bazaar store. Shall I hold it for you till tomorrow 6pm?",
    },
    calculator: { enquiries: 25, ticket: 45_000 },
    thread: {
      opened: '11:42 pm, Sunday',
      messages: [
        { who: 'them', text: 'Is the Kundan set still available?' },
        {
          who: 'agent',
          text: "Ji haan — it's in the Johari Bazaar store. Shall I hold it for you till tomorrow 6pm?",
        },
        { who: 'them', text: 'Haan rakh dijiye. Kitne ka hai?' },
        {
          who: 'agent',
          text: 'The set is ₹1,84,000 with the matching earrings. Held under your name till 6pm tomorrow.',
        },
        { who: 'them', text: 'Thoda kam ho sakta hai?' },
        {
          who: 'agent',
          text: "That one's not mine to decide — I'm putting Rajesh from the store on it now. He'll message you in the morning.",
        },
      ],
      handover: 'Handed to a human at 11:44 pm',
    },
  },
  {
    slug: 'clinics',
    name: 'clinics and dental practices',
    noun: 'clinic',
    marketing:
      "Every enquiry is saved as a lead. Patients get a reminder before the appointment, and those who agreed to hear from you get the next health camp or check-up offer on the same number.",
    subhead:
      'A patient messages after the front desk has gone home. haazir answers in the language they wrote in, offers the slots that are actually free, sends a reminder before the visit — and never gives medical advice.',
    chat: {
      time: '10:18 pm',
      from: 'Doctor sahab ka Saturday ka slot mil jayega?',
      reply: 'Saturday 11:30 am khaali hai. Aapke naam se rakh doon?',
    },
    calculator: { enquiries: 40, ticket: 2_500 },
    thread: {
      opened: '10:18 pm, Thursday',
      messages: [
        { who: 'them', text: 'Doctor sahab ka Saturday ka slot mil jayega?' },
        { who: 'agent', text: 'Saturday 11:30 am khaali hai. Aapke naam se rakh doon?' },
        { who: 'them', text: 'Haan kar dijiye. Consultation ki fees kitni hai?' },
        {
          who: 'agent',
          text: 'Consultation ₹600 hai. Appointment confirm — Saturday 11:30 am. Aane se pehle reminder bhej doonga.',
        },
        { who: 'them', text: 'Mujhe do din se dard ho raha hai, koi dawai bata dijiye?' },
        {
          who: 'agent',
          text: 'Ye main nahi bata sakta — dawai sirf doctor hi likhenge. Aapka Saturday ka slot rakha hai, aur main abhi clinic ko bata raha hoon.',
        },
      ],
      handover: 'Handed to the front desk at 10:20 pm',
    },
  },
  {
    slug: 'hotels',
    name: 'hotels and resorts',
    noun: 'hotel',
    marketing:
      "Every enquiry is saved as a lead. Guests get a reminder before they arrive, and those who agreed to hear from you get the season's offer on the same number.",
    subhead:
      'An enquiry lands at midnight while your front desk is on a night shift. haazir answers in the language they wrote in, checks what is free, holds the room, and passes the thread over the moment someone wants to negotiate a rate.',
    chat: {
      time: '12:06 am',
      from: 'Do you have a room for 2 nights from the 14th?',
      reply: 'Yes — a deluxe double is free on both nights. Shall I hold it while you check with your family?',
    },
    calculator: { enquiries: 35, ticket: 9_000 },
    thread: {
      opened: '12:06 am, Saturday',
      messages: [
        { who: 'them', text: 'Do you have a room for 2 nights from the 14th?' },
        {
          who: 'agent',
          text: 'Yes — a deluxe double is free on both nights. Shall I hold it while you check with your family?',
        },
        { who: 'them', text: 'What does it come to?' },
        {
          who: 'agent',
          text: '₹6,500 a night including breakfast, so ₹13,000 for the two. Held for you till noon tomorrow.',
        },
        { who: 'them', text: 'Can you do 5,500 a night?' },
        {
          who: 'agent',
          text: "Rates are the manager's call, not mine — I've flagged this to him and he'll message you first thing.",
        },
      ],
      handover: 'Handed to the front desk at 12:08 am',
    },
  },
  {
    slug: 'coaching',
    name: 'coaching institutes',
    noun: 'coaching institute',
    marketing:
      "Every enquiry is saved as a lead. Parents get a reminder before the demo class and before each fee instalment, with a payment link, and those who agreed to hear from you get the new batch announcement on the same number.",
    subhead:
      'A parent messages at 11pm asking about fees and batch timings. haazir answers in the language they wrote in, sends the fee structure, books the counselling slot — and hands over the moment they ask for a discount.',
    chat: {
      time: '11:05 pm',
      from: 'NEET batch ki fees aur timing bata dijiye',
      reply: 'Zaroor — morning batch 7–10, evening 5–8. Fee structure bhej doon, ya counselling ka slot rakh doon?',
    },
    calculator: { enquiries: 40, ticket: 25_000 },
    thread: {
      opened: '11:05 pm, Tuesday',
      messages: [
        { who: 'them', text: 'NEET batch ki fees aur timing bata dijiye' },
        {
          who: 'agent',
          text: 'Zaroor — morning batch 7–10, evening 5–8. Fee structure bhej doon, ya counselling ka slot rakh doon?',
        },
        { who: 'them', text: 'Dono bhej dijiye' },
        {
          who: 'agent',
          text: 'Bhej diya. Full course ₹1,10,000, teen instalment mein bhi ho jata hai. Counselling Saturday 12 baje rakh di hai.',
        },
        { who: 'them', text: 'Scholarship ya koi discount milta hai kya?' },
        {
          who: 'agent',
          text: 'Iska faisla Verma sir karte hain, main nahi. Unko abhi bata diya hai — kal subah aapko call karenge.',
        },
      ],
      handover: 'Handed to the counselling desk at 11:07 pm',
    },
  },
]

/** Looks a segment up by its slug. Returns the generic page for anything else. */
export function findSegment(slug) {
  if (!slug) return DEFAULT_SEGMENT
  return SEGMENTS.find((s) => s.slug === slug) ?? DEFAULT_SEGMENT
}
