/** Webhook bodies shaped like Graph API v26.0 deliveries, trimmed to what matters. */

export const PHONE_NUMBER_ID = '106540352242922'

const envelope = (value: Record<string, unknown>, field = 'messages') => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          field,
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '919876500000', phone_number_id: PHONE_NUMBER_ID },
            ...value,
          },
        },
      ],
    },
  ],
})

export const contact = {
  profile: { name: 'Anil Kumar' },
  wa_id: '919812345678',
  user_id: 'IN.13491208655302741918',
}

export function textMessage(
  id = 'wamid.TEXT1',
  body = 'RS-CIT ki fees kitni hai?',
  ts = 1790407200,
) {
  return envelope({
    contacts: [contact],
    messages: [
      {
        from: '919812345678',
        user_id: 'IN.13491208655302741918',
        id,
        timestamp: String(ts),
        type: 'text',
        text: { body },
      },
    ],
  })
}

export const voiceNote = envelope({
  contacts: [contact],
  messages: [
    {
      from: '919812345678',
      id: 'wamid.AUDIO1',
      timestamp: '1790407260',
      type: 'audio',
      audio: { id: '1223344556677', mime_type: 'audio/ogg; codecs=opus', voice: true },
    },
  ],
})

export const buttonReply = envelope({
  contacts: [contact],
  messages: [
    {
      from: '919812345678',
      id: 'wamid.BTN1',
      timestamp: '1790407300',
      type: 'interactive',
      context: { from: '919876500000', id: 'wamid.OUT1' },
      interactive: { type: 'button_reply', button_reply: { id: 'demo_yes', title: 'Haan' } },
    },
  ],
})

export const listReply = envelope({
  contacts: [contact],
  messages: [
    {
      from: '919812345678',
      id: 'wamid.LIST1',
      timestamp: '1790407310',
      type: 'interactive',
      interactive: {
        type: 'list_reply',
        list_reply: { id: 'course_tally', title: 'Tally Prime + GST', description: '3 mahine' },
      },
    },
  ],
})

export const imageWithCaption = envelope({
  contacts: [contact],
  messages: [
    {
      from: '919812345678',
      id: 'wamid.IMG1',
      timestamp: '1790407320',
      type: 'image',
      image: { id: '998877', mime_type: 'image/jpeg', sha256: 'abc', caption: 'Ye receipt hai' },
    },
  ],
})

export const location = envelope({
  contacts: [contact],
  messages: [
    {
      from: '919812345678',
      id: 'wamid.LOC1',
      timestamp: '1790407330',
      type: 'location',
      location: { latitude: 27.6094, longitude: 75.1399, name: 'Sikar Railway Station' },
    },
  ],
})

export const reaction = envelope({
  contacts: [contact],
  messages: [
    {
      from: '919812345678',
      id: 'wamid.REACT1',
      timestamp: '1790407340',
      type: 'reaction',
      reaction: { message_id: 'wamid.OUT1', emoji: '👍' },
    },
  ],
})

export const unknownType = envelope({
  contacts: [contact],
  messages: [
    {
      from: '919812345678',
      id: 'wamid.UNK1',
      timestamp: '1790407350',
      type: 'unsupported',
      errors: [{ code: 131051, title: 'Message type unknown' }],
    },
  ],
})

/** A user who has adopted a WhatsApp username: no phone number, only a BSUID. */
export const usernameUser = envelope({
  contacts: [
    { profile: { name: 'Riya' }, wa_id: 'IN.99887766554433', user_id: 'IN.99887766554433' },
  ],
  messages: [
    {
      from: 'IN.99887766554433',
      user_id: 'IN.99887766554433',
      id: 'wamid.BSUID1',
      timestamp: '1790407360',
      type: 'text',
      text: { body: 'Hello' },
    },
  ],
})

export function status(
  id: string,
  value: 'sent' | 'delivered' | 'read' | 'failed',
  extra: Record<string, unknown> = {},
) {
  return envelope({
    statuses: [
      {
        id,
        status: value,
        timestamp: '1790407400',
        recipient_id: '919812345678',
        pricing: {
          billable: false,
          pricing_model: 'PMP',
          category: 'service',
          type: 'free_customer_service',
        },
        ...extra,
      },
    ],
  })
}

export const failedStatus = status('wamid.OUT2', 'failed', {
  errors: [
    {
      code: 131047,
      title: 'Re-engagement message',
      message: 'Re-engagement message',
      error_data: { details: 'Message failed to send because more than 24 hours have passed.' },
    },
  ],
})

export const templateStatusUpdate = (event = 'APPROVED', reason = 'NONE') =>
  envelope(
    {
      event,
      message_template_id: 1689556908129832,
      message_template_name: 'fee_due',
      message_template_language: 'hi',
      reason,
    },
    'message_template_status_update',
  )

export const templateCategoryUpdate = envelope(
  {
    message_template_id: 1689556908129832,
    message_template_name: 'fee_due',
    message_template_language: 'hi',
    previous_category: 'UTILITY',
    new_category: 'MARKETING',
  },
  'template_category_update',
)

export const accountUpdate = envelope({ event: 'VERIFIED_ACCOUNT' }, 'account_update')
