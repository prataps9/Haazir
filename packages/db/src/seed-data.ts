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
  latitude: 27.6094,
  longitude: 75.1399,
  phone: '911000000100',
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

/**
 * Demo CRM for the first institute (spec §8: 30 contacts, 15 leads, 10
 * students). Numbers start "91 1…", which no Indian mobile number does, so a
 * demo can never message a real person.
 */
const NAMES = [
  'Anil Kumar',
  'Sunita Devi',
  'Ravi Meena',
  'Pooja Saini',
  'Mahesh Jangid',
  'Kavita Sharma',
  'Suresh Choudhary',
  'Neha Agarwal',
  'Vikram Singh',
  'Priya Kumawat',
  'Deepak Yadav',
  'Rekha Bhargava',
  'Manoj Gurjar',
  'Anjali Verma',
  'Rajesh Swami',
  'Komal Prajapat',
  'Sanjay Bajiya',
  'Meena Khandelwal',
  'Harish Sain',
  'Seema Jat',
  'Rohit Soni',
  'Jyoti Mahala',
  'Ashok Dhaka',
  'Mamta Gupta',
  'Naresh Ola',
  'Babita Sharma',
  'Pankaj Beniwal',
  'Geeta Kanwar',
  'Lalit Joshi',
  'Ritu Saini',
] as const

export const DEMO_CONTACTS = NAMES.map((name, i) => ({
  waId: `9110000001${String(i + 1).padStart(2, '0')}`,
  name,
  profileName: name.split(' ')[0]!,
  language: i % 5 === 0 ? 'hi' : 'hinglish',
  // A few tags so campaign audiences have something to pick from.
  tags: i % 3 === 0 ? ['parent'] : i % 4 === 1 ? ['college'] : [],
}))

/** Contacts 28 and 29 said STOP: no campaign or reminder may reach them. */
export const DEMO_OPTED_OUT = new Set([28, 29])

/** Stage, course and age (days ago) of the 15 open enquiries. Contacts 0–14. */
export const DEMO_LEADS: {
  contact: number
  stage: 'new' | 'contacted' | 'demo_booked' | 'demo_done' | 'admitted' | 'lost'
  course: string
  daysAgo: number
  source?: 'whatsapp' | 'walkin' | 'referral' | 'ad'
  lostReason?: string
}[] = [
  { contact: 0, stage: 'new', course: 'RS-CIT', daysAgo: 0 },
  { contact: 1, stage: 'new', course: 'Tally Prime + GST', daysAgo: 0 },
  { contact: 2, stage: 'new', course: 'Python + AI', daysAgo: 1 },
  { contact: 3, stage: 'contacted', course: 'RS-CIT', daysAgo: 2 },
  { contact: 4, stage: 'contacted', course: 'Web Development', daysAgo: 3, source: 'referral' },
  { contact: 5, stage: 'contacted', course: 'Tally Prime + GST', daysAgo: 4 },
  { contact: 6, stage: 'demo_booked', course: 'RS-CIT', daysAgo: 1 },
  { contact: 7, stage: 'demo_booked', course: 'Python + AI', daysAgo: 2 },
  { contact: 8, stage: 'demo_booked', course: 'Tally Prime + GST', daysAgo: 1, source: 'ad' },
  { contact: 9, stage: 'demo_done', course: 'Web Development', daysAgo: 5 },
  { contact: 10, stage: 'demo_done', course: 'RS-CIT', daysAgo: 6, source: 'walkin' },
  { contact: 11, stage: 'admitted', course: 'RS-CIT', daysAgo: 12 },
  { contact: 12, stage: 'admitted', course: 'Tally Prime + GST', daysAgo: 20 },
  { contact: 13, stage: 'lost', course: 'Python + AI', daysAgo: 9, lostReason: 'fees_high' },
  { contact: 14, stage: 'lost', course: 'Web Development', daysAgo: 15, lostReason: 'too_far' },
]

/** Ten admitted students (contacts 11, 12 and 15–22), admitted this many days ago. */
export const DEMO_STUDENTS: { contact: number; course: string; batch: string; daysAgo: number }[] =
  [
    { contact: 11, course: 'RS-CIT', batch: 'RS-CIT Subah', daysAgo: 12 },
    { contact: 12, course: 'Tally Prime + GST', batch: 'Tally Subah', daysAgo: 20 },
    { contact: 15, course: 'RS-CIT', batch: 'RS-CIT Shaam', daysAgo: 40 },
    { contact: 16, course: 'RS-CIT', batch: 'RS-CIT Subah', daysAgo: 33 },
    { contact: 17, course: 'Tally Prime + GST', batch: 'Tally Weekend', daysAgo: 58 },
    { contact: 18, course: 'Web Development', batch: 'Web Dev Shaam', daysAgo: 27 },
    { contact: 19, course: 'Python + AI', batch: 'Python Dopahar', daysAgo: 64 },
    { contact: 20, course: 'RS-CIT', batch: 'RS-CIT Shaam', daysAgo: 5 },
    { contact: 21, course: 'Web Development', batch: 'Web Dev Shaam', daysAgo: 88 },
    { contact: 22, course: 'Tally Prime + GST', batch: 'Tally Subah', daysAgo: 3 },
  ]

/** Sample chat lines (Hinglish), inbound first, replayed into the first few conversations. */
export const DEMO_THREADS: { contact: number; lines: [dir: 'in' | 'out', text: string][] }[] = [
  {
    contact: 0,
    lines: [
      ['in', 'Namaste, RS-CIT ki fees kitni hai?'],
      ['out', '*RS-CIT* ki total fees *₹4,500* hai. Free demo class book karni hai?'],
      ['in', 'Haan, kal subah ho sakti hai?'],
      ['out', 'Ji bilkul. Subah 8 baje ka batch hai. Student ka naam bata dijiye.'],
    ],
  },
  {
    contact: 1,
    lines: [
      ['in', 'Tally ka course kitne mahine ka hai?'],
      ['out', '*Tally Prime + GST* 3 mahine ka course hai. Batch timings bhej doon?'],
      ['in', 'Haan bhejiye'],
    ],
  },
  {
    contact: 2,
    lines: [
      ['in', 'Python AI course mein kya sikhate ho?'],
      ['out', 'Python basics se lekar AI tools tak. Free demo dekhna chahenge?'],
      ['in', 'Weekend mein ho sakti hai?'],
      ['out', 'Team aapko weekend ka slot confirm karegi.'],
    ],
  },
  {
    contact: 3,
    lines: [
      ['in', 'RSCIT ka exam kab hota hai?'],
      ['out', 'Main aapki baat team se karwa raha hoon. Thodi der mein jawab milega.'],
      ['in', 'Theek hai'],
    ],
  },
  {
    contact: 6,
    lines: [
      ['in', 'Demo book karni hai RS-CIT ki'],
      ['out', 'Aapki demo class book ho gayi hai. Pata: Station Road, Sikar.'],
      ['in', 'Dhanyavaad'],
      ['out', 'Aapka swagat hai!'],
    ],
  },
  {
    contact: 7,
    lines: [
      ['in', 'Python ki demo kal hai na?'],
      ['out', 'Ji haan, kal dopahar 2 baje. Aa rahe hain?'],
      ['in', 'Haan aa raha hoon'],
    ],
  },
  {
    contact: 11,
    lines: [
      ['in', 'Meri agli kisht kab hai?'],
      ['out', 'Aapki agli kisht ki jaankari team bhej degi.'],
      ['in', 'Ok'],
    ],
  },
  {
    contact: 13,
    lines: [
      ['in', 'Python ki fees kuch kam ho sakti hai?'],
      ['out', 'Fees mein badlav ke liye main team se baat karwata hoon.'],
      ['in', 'Rehne do, bahut zyada hai'],
    ],
  },
  {
    contact: 9,
    lines: [
      ['in', 'Demo achhi lagi, admission kaise hoga?'],
      ['out', 'Bahut badhiya! Admission ke liye Aadhaar aur 2 photo leke aaiye.'],
      ['in', 'Kal aata hoon'],
      ['out', 'Ji, intezaar rahega.'],
    ],
  },
  {
    contact: 10,
    lines: [
      ['in', 'RS-CIT ki shaam wali class kitne baje hai?'],
      ['out', 'Shaam ka batch 5 baje se 7 baje tak hai.'],
      ['in', 'Thik hai, sochke batata hoon'],
      ['out', 'Zaroor. Koi sawaal ho to likhiye.'],
    ],
  },
  {
    contact: 4,
    lines: [
      ['in', 'Web development mein job milegi?'],
      [
        'out',
        'Course mein HTML, CSS, JavaScript aur projects sikhaye jaate hain. Job ki guarantee hum nahi dete.',
      ],
      ['in', 'Achha. Fees?'],
      ['out', '*Web Development* ki total fees ₹18,000 hai.'],
    ],
  },
]
