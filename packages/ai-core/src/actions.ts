/**
 * What the agent wants done besides its reply. `decideReply` only returns
 * these; the worker's effects carry them out (book, send, update the lead),
 * so the playground and evals can run the same brain without changing anything.
 */
export type AgentAction =
  | {
      type: 'book_demo'
      courseId: string
      batchId: string
      /** IST calendar date and the batch's start time. */
      date: string
      startTime: string
      studentName: string
    }
  | { type: 'upsert_lead'; courseId?: string; studentName?: string; notes?: string }
  | { type: 'send_brochure'; courseId: string }
  | { type: 'send_location' }
  | { type: 'send_payment_link'; installmentId: string }
  /** The person's answer to a demo reminder: coming, or wants another time. */
  | { type: 'demo_answer'; bookingId: string; answer: 'coming' | 'reschedule' }
