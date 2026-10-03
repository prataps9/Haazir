import type { BusinessHours, PlanLimits } from '@haazir/shared'

/**
 * Plans exactly as priced in the spec (§1). Changing these numbers is a pricing
 * decision for Pratap, not a code change — after launch, edit them in
 * super admin instead of here.
 */
export const PLANS: {
  code: string
  name: string
  setupFeePaise: number
  monthlyPaise: number
  sort: number
  limits: PlanLimits
}[] = [
  {
    code: 'starter',
    name: 'Starter',
    setupFeePaise: 7_999_00,
    monthlyPaise: 2_499_00,
    sort: 1,
    limits: {
      numbers: 1,
      seats: 2,
      aiReplies: 1_500,
      campaigns: 1,
      features: ['faq_bot', 'leads'],
    },
  },
  {
    code: 'growth',
    name: 'Growth',
    setupFeePaise: 19_999_00,
    monthlyPaise: 4_999_00,
    sort: 2,
    limits: {
      numbers: 1,
      seats: 5,
      aiReplies: 5_000,
      campaigns: 4,
      features: ['faq_bot', 'leads', 'courses', 'demo_booking', 'fee_reminders'],
    },
  },
  {
    code: 'pro',
    name: 'Pro',
    setupFeePaise: 39_999_00,
    monthlyPaise: 9_999_00,
    sort: 3,
    limits: {
      numbers: 3,
      seats: 15,
      aiReplies: 15_000,
      campaigns: null, // assumption: "everything" means no monthly campaign cap
      features: [
        'faq_bot',
        'leads',
        'courses',
        'demo_booking',
        'fee_reminders',
        'sheets_sync',
        'priority_support',
      ],
    },
  },
]

const weekday = { open: '08:00', close: '20:00' }

export const DEMO_ORG = {
  name: 'Shiksha Computer Institute',
  slug: 'shiksha-computer-sikar',
  vertical: 'coaching' as const,
  city: 'Sikar',
  state: 'Rajasthan',
  address: 'Station Road, Sikar, Rajasthan 332001',
  defaultLanguage: 'hinglish' as const,
  status: 'active' as const,
  businessHours: {
    mon: weekday,
    tue: weekday,
    wed: weekday,
    thu: weekday,
    fri: weekday,
    sat: weekday,
    sun: { open: '09:00', close: '13:00' },
  } satisfies BusinessHours,
  brand: { displayName: 'Shiksha Computer, Sikar' },
  onboardingStep: 8,
}

// `.example` addresses can never reach a real inbox.
export const DEMO_USERS = {
  owner: { name: 'Rakesh Sharma', email: 'rakesh@shiksha.example', uiLanguage: 'hi' as const },
  staff: { name: 'Pooja Verma', email: 'pooja@shiksha.example', uiLanguage: 'hi' as const },
  superAdmin: { name: 'Pratap', email: 'pratap@haazir.example', uiLanguage: 'en' as const },
}

/**
 * Local development only: every demo user logs in with this password. The
 * seed refuses to set it when NODE_ENV is production.
 */
export const DEMO_PASSWORD = 'haazir-demo-2026'

/** A second institute, so tenant isolation is exercised everywhere (spec §22, Phase 3). */
export const SECOND_ORG = {
  name: 'Pragati Computer Academy',
  slug: 'pragati-computer-churu',
  vertical: 'coaching' as const,
  city: 'Churu',
  state: 'Rajasthan',
  address: 'Subhash Chowk, Churu, Rajasthan 331001',
  defaultLanguage: 'hinglish' as const,
  status: 'active' as const,
  brand: { displayName: 'Pragati Computer, Churu' },
  onboardingStep: 8,
}

export const SECOND_ORG_OWNER = {
  name: 'Sunita Choudhary',
  email: 'sunita@pragati.example',
  uiLanguage: 'hi' as const,
}

// ---- Phase 2: the demo institute's courses, batches, bot and FAQs ----
// Demo data for development, the eval fixture and screenshots. Fees are
// plausible for Sikar, not real quotes.

export const DEMO_COURSES = [
  {
    name: 'RS-CIT (Rajasthan State Certificate Course in IT)',
    shortName: 'RS-CIT',
    description:
      'Computer ki basic training: Windows, MS Office, internet, email, e-governance aur digital payments. Rajasthan sarkari naukri ke liye zaroori certificate.',
    durationText: '3 mahine',
    mode: 'offline' as const,
    feeTotalPaise: 4_500_00,
    installmentPlan: [{ label: 'Poori fees', amountPaise: 4_500_00, dueOffsetDays: 0 }],
    certificateText: 'VMOU (Vardhman Mahaveer Open University) ka certificate, RKCL ke through',
    sort: 1,
  },
  {
    name: 'Tally Prime + GST',
    shortName: 'Tally Prime + GST',
    description:
      'Accounting, GST returns, inventory aur payroll, Tally Prime par practical ke saath.',
    durationText: '3 mahine',
    mode: 'offline' as const,
    feeTotalPaise: 8_500_00,
    installmentPlan: [
      { label: 'Pehli kisht', amountPaise: 4_500_00, dueOffsetDays: 0 },
      { label: 'Doosri kisht', amountPaise: 4_000_00, dueOffsetDays: 30 },
    ],
    certificateText: 'Institute ka certificate',
    sort: 2,
  },
  {
    name: 'Web Development',
    shortName: 'Web Development',
    description: 'HTML, CSS, JavaScript, React aur Node.js. Course ke ant mein apni website live.',
    durationText: '6 mahine',
    mode: 'hybrid' as const,
    feeTotalPaise: 18_000_00,
    installmentPlan: [
      { label: 'Pehli kisht', amountPaise: 6_000_00, dueOffsetDays: 0 },
      { label: 'Doosri kisht', amountPaise: 6_000_00, dueOffsetDays: 60 },
      { label: 'Teesri kisht', amountPaise: 6_000_00, dueOffsetDays: 120 },
    ],
    certificateText: 'Institute ka certificate',
    sort: 3,
  },
  {
    name: 'Python + AI',
    shortName: 'Python + AI',
    description: 'Python programming, data handling aur AI tools ka basic practical kaam.',
    durationText: '4 mahine',
    mode: 'offline' as const,
    feeTotalPaise: 15_000_00,
    installmentPlan: [
      { label: 'Pehli kisht', amountPaise: 7_500_00, dueOffsetDays: 0 },
      { label: 'Doosri kisht', amountPaise: 7_500_00, dueOffsetDays: 45 },
    ],
    certificateText: 'Institute ka certificate',
    sort: 4,
  },
]

/** Batches, with start dates relative to seeding so "upcoming" stays upcoming. */
export const DEMO_BATCHES: {
  course: string
  name: string
  days: string[]
  startTime: string
  endTime: string
  startInDays: number
  seatsTotal: number
  seatsFilled: number
  demoAllowed: boolean
}[] = [
  {
    course: 'RS-CIT',
    name: 'RS-CIT Subah',
    days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    startTime: '08:00',
    endTime: '09:30',
    startInDays: 9,
    seatsTotal: 30,
    seatsFilled: 22,
    demoAllowed: true,
  },
  {
    course: 'RS-CIT',
    name: 'RS-CIT Shaam',
    days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    startTime: '17:00',
    endTime: '18:30',
    startInDays: 16,
    seatsTotal: 30,
    seatsFilled: 9,
    demoAllowed: true,
  },
  {
    course: 'Tally Prime + GST',
    name: 'Tally Subah',
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    startTime: '10:00',
    endTime: '11:30',
    startInDays: 9,
    seatsTotal: 20,
    seatsFilled: 14,
    demoAllowed: true,
  },
  {
    course: 'Tally Prime + GST',
    name: 'Tally Weekend',
    days: ['sat', 'sun'],
    startTime: '11:00',
    endTime: '14:00',
    startInDays: 14,
    seatsTotal: 15,
    seatsFilled: 3,
    demoAllowed: false,
  },
  {
    course: 'Web Development',
    name: 'Web Dev Shaam',
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    startTime: '18:00',
    endTime: '20:00',
    startInDays: 37,
    seatsTotal: 20,
    seatsFilled: 6,
    demoAllowed: true,
  },
  {
    course: 'Python + AI',
    name: 'Python Dopahar',
    days: ['mon', 'wed', 'fri'],
    startTime: '14:00',
    endTime: '16:00',
    startInDays: 23,
    seatsTotal: 18,
    seatsFilled: 11,
    demoAllowed: true,
  },
]

export const DEMO_BOT_CONFIG = {
  personaName: 'Haazir Sahayak',
  tone: 'warm' as const,
  greeting: {
    hinglish:
      'Namaste! Shiksha Computer Institute mein aapka swagat hai. Main aapki kya madad karun?',
    hi: 'नमस्ते! शिक्षा कंप्यूटर इंस्टीट्यूट में आपका स्वागत है। मैं आपकी क्या मदद करूँ?',
    en: 'Hello! Welcome to Shiksha Computer Institute. How can I help you?',
  },
  mainMenu: [
    {
      id: 'menu_courses',
      title: { hinglish: 'Courses dekhein', hi: 'कोर्स देखें', en: 'See courses' },
    },
    { id: 'menu_demo', title: { hinglish: 'Free demo', hi: 'फ्री डेमो', en: 'Free demo' } },
    { id: 'menu_talk', title: { hinglish: 'Baat karein', hi: 'बात करें', en: 'Talk to us' } },
  ],
  handoffKeywords: [
    'insaan',
    'human',
    'manager',
    'owner',
    'sir se baat',
    'call karo',
    'call me',
    'इंसान',
  ],
  optoutKeywords: ['stop', 'unsubscribe', 'band karo', 'मत भेजो', 'बंद करो'],
  competitorNames: ['Vidya Computer Centre', 'Sikar Tech Academy'],
  maxAiRepliesPerContactHour: 20,
}

/** What the institute's own documents would say. Ingested (embedded) when an embedding key is set. */
export const DEMO_FAQS: { question: string; answer: string }[] = [
  {
    question: 'Institute kahan hai? Address kya hai?',
    answer:
      'Shiksha Computer Institute, Station Road, Sikar (Rajasthan) 332001. Railway station se 5 minute paidal, SBI bank ke upar pehli manzil par.',
  },
  {
    question: 'Institute kitne baje khulta hai?',
    answer:
      'Somvar se Shanivar subah 8 baje se raat 8 baje tak, aur Ravivar subah 9 se dopahar 1 baje tak.',
  },
  {
    question: 'Admission ke liye kaunse documents chahiye?',
    answer: 'Aadhaar card ki copy, 2 passport size photo, aur 10th ki marksheet ki copy.',
  },
  {
    question: 'Kya fees mein discount milta hai?',
    answer:
      'Fees mein koi discount nahi hai. Lekin Tally, Web Development aur Python ki fees kishton mein di ja sakti hai.',
  },
  {
    question: 'Fees wapas milti hai kya? Refund policy?',
    answer:
      'Admission ke 7 din ke andar class shuru hone se pehle fees wapas mil sakti hai. Uske baad fees wapas nahi hoti.',
  },
  {
    question: 'Kya naukri ki guarantee hai?',
    answer:
      'Hum naukri ki guarantee nahi dete. Course ke baad resume banane aur interview ki taiyari mein madad karte hain.',
  },
  {
    question: 'Lab mein kitne computer hain? Practical hota hai?',
    answer:
      'Lab mein 40 computer hain. Har class mein aadha samay practical hota hai, har student ko apna computer milta hai.',
  },
  {
    question: 'Free demo class kya hoti hai?',
    answer:
      'Kisi bhi course ki ek class free mein dekh sakte hain. Demo sirf un batches mein hota hai jinmein demo allowed hai; tareekh team confirm karti hai.',
  },
  {
    question: 'Parking hai kya?',
    answer: 'Building ke saamne two-wheeler parking hai. Car parking uplabdh nahi hai.',
  },
  {
    question: 'Online class hoti hai?',
    answer:
      'Web Development hybrid hai: hafte mein 3 din institute mein aur 2 din online. Baaki courses sirf institute mein hote hain.',
  },
  {
    question: 'RS-CIT ka exam kaise hota hai?',
    answer:
      'RS-CIT ka final exam VMOU leta hai, online, RKCL ke exam centre par. Exam ki tareekh course ke ant mein batayi jaati hai.',
  },
]
