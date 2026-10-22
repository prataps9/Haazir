import { describe, expect, it } from 'vitest'
import { parseWebhook, previewOf } from '../parser'
import * as fx from './fixtures/payloads'

describe('parseWebhook: messages', () => {
  it('parses a text message with the sender, profile name and BSUID', () => {
    const { messages, statuses, problems } = parseWebhook(fx.textMessage())
    expect(problems).toEqual([])
    expect(statuses).toEqual([])
    expect(messages).toEqual([
      {
        phoneNumberId: fx.PHONE_NUMBER_ID,
        waMessageId: 'wamid.TEXT1',
        from: '919812345678',
        bsuid: 'IN.13491208655302741918',
        profileName: 'Anil Kumar',
        timestamp: new Date(1790407200 * 1000),
        type: 'text',
        text: 'RS-CIT ki fees kitni hai?',
        replyTo: undefined,
      },
    ])
  })

  it('parses a voice note as audio media, marked as voice', () => {
    const [m] = parseWebhook(fx.voiceNote).messages
    expect(m?.type).toBe('audio')
    expect(m?.media).toEqual({
      id: '1223344556677',
      mimeType: 'audio/ogg; codecs=opus',
      voice: true,
    })
    expect(m?.bsuid).toBe('IN.13491208655302741918') // from contacts[] when the message lacks it
  })

  it('parses button and list replies, including what they reply to', () => {
    const [button] = parseWebhook(fx.buttonReply).messages
    expect(button?.interactive).toEqual({ kind: 'button_reply', id: 'demo_yes', title: 'Haan' })
    expect(button?.text).toBe('Haan')
    expect(button?.replyTo).toBe('wamid.OUT1')

    const [list] = parseWebhook(fx.listReply).messages
    expect(list?.interactive).toEqual({
      kind: 'list_reply',
      id: 'course_tally',
      title: 'Tally Prime + GST',
    })
  })

  it('keeps an image caption as the text', () => {
    const [m] = parseWebhook(fx.imageWithCaption).messages
    expect(m?.type).toBe('image')
    expect(m?.text).toBe('Ye receipt hai')
    expect(m?.media?.id).toBe('998877')
  })

  it('parses location and reaction', () => {
    expect(parseWebhook(fx.location).messages[0]?.location).toMatchObject({
      latitude: 27.6094,
      longitude: 75.1399,
    })
    expect(parseWebhook(fx.reaction).messages[0]?.reaction).toEqual({
      messageId: 'wamid.OUT1',
      emoji: '👍',
    })
  })

  it('turns unknown types into unsupported rather than dropping them', () => {
    expect(parseWebhook(fx.unknownType).messages[0]?.type).toBe('unsupported')
  })

  it('handles username users who arrive with a BSUID and no phone number', () => {
    const [m] = parseWebhook(fx.usernameUser).messages
    expect(m?.from).toBe('IN.99887766554433')
    expect(m?.bsuid).toBe('IN.99887766554433')
    expect(m?.profileName).toBe('Riya')
  })
})

describe('parseWebhook: statuses', () => {
  it('parses delivery statuses with the pricing category', () => {
    const { statuses, messages } = parseWebhook(fx.status('wamid.OUT1', 'delivered'))
    expect(messages).toEqual([])
    expect(statuses).toEqual([
      {
        phoneNumberId: fx.PHONE_NUMBER_ID,
        waMessageId: 'wamid.OUT1',
        status: 'delivered',
        timestamp: new Date(1790407400 * 1000),
        recipient: '919812345678',
        pricingCategory: 'service',
        billable: false,
        errors: [],
      },
    ])
  })

  it('keeps the reason a message failed', () => {
    const [s] = parseWebhook(fx.failedStatus).statuses
    expect(s?.status).toBe('failed')
    expect(s?.errors).toEqual([
      {
        code: 131047,
        title: 'Re-engagement message',
        details: 'Message failed to send because more than 24 hours have passed.',
      },
    ])
  })
})

describe('parseWebhook: robustness', () => {
  it('ignores fields it does not handle', () => {
    const result = parseWebhook(fx.accountUpdate)
    expect(result.ignoredFields).toEqual(['account_update'])
    expect(result.problems).toEqual([])
  })

  it('reports junk instead of throwing', () => {
    expect(parseWebhook(null).problems).toHaveLength(1)
    expect(parseWebhook({ object: 'page', entry: [] }).problems).toHaveLength(1)
  })

  it('skips one malformed message without losing the rest of the batch', () => {
    const body = fx.textMessage()
    const value = body.entry[0]!.changes[0]!.value as unknown as { messages: unknown[] }
    value.messages.unshift({ id: 'wamid.BAD', type: 'text' }) // no from, no timestamp
    const result = parseWebhook(body)
    expect(result.messages.map((m) => m.waMessageId)).toEqual(['wamid.TEXT1'])
    expect(result.problems).toHaveLength(1)
  })
})

describe('parseWebhook: templates', () => {
  it('reads a review result, keyed by the business account', () => {
    expect(parseWebhook(fx.templateStatusUpdate()).templates).toEqual([
      {
        wabaId: '102290129340398',
        metaTemplateId: '1689556908129832',
        name: 'fee_due',
        language: 'hi',
        event: 'APPROVED',
        reason: undefined,
      },
    ])
  })

  it('keeps the rejection reason', () => {
    const [t] = parseWebhook(fx.templateStatusUpdate('REJECTED', 'INVALID_FORMAT')).templates
    expect(t).toMatchObject({ event: 'REJECTED', reason: 'INVALID_FORMAT' })
  })

  it('reads a category change in our lower case', () => {
    const [t] = parseWebhook(fx.templateCategoryUpdate).templates
    expect(t).toMatchObject({ metaTemplateId: '1689556908129832', newCategory: 'marketing' })
  })
})

describe('previewOf', () => {
  it('prefers the text, otherwise names the type in plain words', () => {
    expect(previewOf({ type: 'text', text: 'Namaste' })).toBe('Namaste')
    expect(previewOf({ type: 'audio' })).toBe('Voice note')
    expect(previewOf({ type: 'text', text: 'x'.repeat(500) })).toHaveLength(120)
  })
})
