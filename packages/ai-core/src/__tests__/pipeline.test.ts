import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { botConfigs, conversations, knowledgeChunks, knowledgeSources, messages } from '@haazir/db'
import { decideReply, isKeywordMessage, type PipelineDeps } from '../pipeline'
import { createFixture, hashEmbedding, models, router, scripted } from './helpers'

const MONDAY_11AM_IST = new Date('2026-09-28T05:30:00Z')
const MONDAY_1140PM_IST = new Date('2026-09-28T18:10:00Z')

let f: Awaited<ReturnType<typeof createFixture>>
beforeEach(async () => {
  f = await createFixture()
})
afterEach(() => f.close())

const deps = (m: PipelineDeps['models'], now = MONDAY_11AM_IST): PipelineDeps => ({
  db: f.db,
  models: m,
  now: () => now,
})

describe('answers from the database, never from memory', () => {
  it('fee question: calls the tool and quotes its exact fee, with next-step buttons', async () => {
    const smart = scripted(
      { tool: 'get_course_details', input: { course: 'rscit' } },
      {
        text: '*RS-CIT* ki poori fees *₹4,500* hai, 3 mahine ka course. Free demo dekhna chahenge?',
      },
    )
    const turn = await f.inbound('RSCIT ki fees kitni hai bhaiya')
    const d = await decideReply(
      deps(models(router({ intent: 'fee_query', language: 'hinglish', script: 'latin' }), smart)),
      turn,
    )

    expect(d.kind).toBe('reply')
    if (d.kind !== 'reply') return
    expect(d.content).toEqual({
      kind: 'buttons',
      body: '*RS-CIT* ki poori fees *₹4,500* hai, 3 mahine ka course. Free demo dekhna chahenge?',
      buttons: [
        { id: 'menu_demo', title: 'Free demo' },
        { id: 'menu_talk', title: 'Baat karein' },
      ],
    })
    expect(d.trace).toMatchObject({
      intent: 'fee_query',
      language: 'hinglish',
      model: 'mock-smart',
      promptVersion: 'answer-v1',
    })
    expect(d.trace.toolCalls.map((t) => t.name)).toEqual(['get_course_details'])
    expect(d.trace.inputTokens).toBeGreaterThan(0)
  })

  it('an invented fee is caught, retried once, and handed over if it happens again', async () => {
    const smart = scripted({ text: 'RS-CIT ki fees ₹4,000 hai.' })
    const turn = await f.inbound('rscit fees?')
    const d = await decideReply(
      deps(models(router({ intent: 'fee_query', language: 'hinglish', script: 'latin' }), smart)),
      turn,
    )
    expect(d.kind).toBe('handoff')
    if (d.kind !== 'handoff') return
    expect(d.reason).toBe('guardrail')
    expect(d.trace.guardrailFlags).toContain('invented_number:4000')
    expect(d.trace.guardrailFlags).toContain('retry:invented_number:4000')
    expect(smart.doGenerateCalls).toHaveLength(2)
  })

  it('a retry that fixes the problem is sent', async () => {
    const smart = scripted(
      { text: 'RS-CIT ki fees ₹4,000 hai.' },
      { tool: 'get_course_details', input: { course: 'rscit' } },
      { text: 'RS-CIT ki fees *₹4,500* hai.' },
    )
    const turn = await f.inbound('rscit fees?')
    const d = await decideReply(
      deps(models(router({ intent: 'fee_query', language: 'hinglish', script: 'latin' }), smart)),
      turn,
    )
    expect(d.kind).toBe('reply')
    // The retry was told exactly what was wrong.
    const retryPrompt = JSON.stringify(smart.doGenerateCalls[1]!.prompt)
    expect(retryPrompt).toContain('The number 4000 is not in the tool results')
  })

  it('answers Devanagari in Devanagari: a Roman-script reply is sent back for a rewrite', async () => {
    const smart = scripted(
      { tool: 'get_course_details', input: { course: 'rscit' } },
      { text: 'RS-CIT ki fees ₹4,500 hai.' },
      { text: 'आरएस-सीआईटी की फीस *₹4,500* है।' },
    )
    const turn = await f.inbound('RS-CIT की फीस कितनी है?')
    const d = await decideReply(
      deps(models(router({ intent: 'fee_query', language: 'hi', script: 'devanagari' }), smart)),
      turn,
    )
    expect(d.kind).toBe('reply')
    if (d.kind === 'reply') expect(d.content.body).toBe('आरएस-सीआईटी की फीस *₹4,500* है।')
  })
})

describe('handing over', () => {
  it('missing information: hands over and records the question to teach the bot', async () => {
    const smart = scripted(
      {
        tool: 'handoff_to_human',
        input: { reason: 'missing_info', summary: 'Hostel ke baare mein poochh rahe hain' },
      },
      { text: 'Main team se confirm karke batata hoon.' },
    )
    const turn = await f.inbound('Hostel ki suvidha hai kya?')
    const d = await decideReply(
      deps(models(router({ intent: 'other', language: 'hinglish', script: 'latin' }), smart)),
      turn,
    )
    expect(d).toMatchObject({
      kind: 'handoff',
      reason: 'missing_info',
      summary: 'Hostel ke baare mein poochh rahe hain',
      unanswered: 'Hostel ki suvidha hai kya?',
      content: { body: 'Main aapki baat team se karwa raha hoon. Thodi der mein jawab milega.' },
    })
  })

  it('after hours, says when the team will reply', async () => {
    const turn = await f.inbound('mujhe kisi se baat karni hai', { type: 'text' })
    const d = await decideReply(
      deps(
        models(
          router({ intent: 'talk_to_human', language: 'hinglish', script: 'latin' }),
          scripted({ text: '' }),
        ),
        MONDAY_1140PM_IST,
      ),
      turn,
    )
    expect(d.kind).toBe('handoff')
    if (d.kind === 'handoff')
      expect(d.content.body).toContain('Abhi institute band hai. Team kal 8:00 AM se jawab degi.')
  })

  it('photos go to a person with an acknowledgement', async () => {
    const turn = await f.inbound('Fees ki receipt', { type: 'image' })
    const d = await decideReply(deps(null), turn)
    expect(d).toMatchObject({
      kind: 'handoff',
      reason: 'media',
      content: { body: 'Photo mil gayi, team dekh kar reply karegi.' },
    })
  })

  it('with no AI configured, every message goes to a person rather than unanswered', async () => {
    const turn = await f.inbound('RSCIT ki fees kitni hai')
    expect(await decideReply(deps(null), turn)).toMatchObject({
      kind: 'handoff',
      reason: 'ai_unavailable',
    })
  })

  it('"Baat karein" button hands over without asking the router', async () => {
    const fast = router({ intent: 'fee_query', language: 'hinglish', script: 'latin' })
    const turn = await f.inbound('Baat karein', {
      type: 'interactive',
      interactive: { kind: 'button_reply', id: 'menu_talk', title: 'Baat karein' },
    })
    const d = await decideReply(deps(models(fast, scripted({ text: '' }))), turn)
    expect(d).toMatchObject({ kind: 'handoff', reason: 'asked_for_human' })
    expect(fast.doGenerateCalls).toHaveLength(0)
  })

  it('too many bot replies in an hour hands over (spam protection)', async () => {
    await f.db.update(botConfigs).set({ maxAiRepliesPerContactHour: 2 })
    for (const body of ['a', 'b']) {
      await f.db.insert(messages).values({
        orgId: f.org.id,
        conversationId: f.conversation.id,
        direction: 'out',
        type: 'text',
        body,
        sentBy: 'bot',
        status: 'sent',
        createdAt: new Date(MONDAY_11AM_IST.getTime() - 10 * 60_000),
      })
    }
    const turn = await f.inbound('aur batao')
    expect(
      await decideReply(deps(models(router({ intent: 'other' }), scripted({ text: 'x' }))), turn),
    ).toMatchObject({ kind: 'handoff', reason: 'rate_limit' })
  })
})

describe('pre-checks', () => {
  it('STOP opts out, in the language of the message', async () => {
    expect(await decideReply(deps(null), await f.inbound('STOP'))).toMatchObject({
      kind: 'optout',
      content: { body: "Okay, we won't message you again." },
    })
    expect(await decideReply(deps(null), await f.inbound('मत भेजो'))).toMatchObject({
      kind: 'optout',
      content: { body: 'ठीक है जी, अब हम आपको मैसेज नहीं भेजेंगे।' },
    })
  })

  it('does not treat a question that merely contains "stop" as an opt-out', () => {
    expect(isKeywordMessage('bus stop ke paas institute hai kya aapka?', ['stop'])).toBe(false)
    expect(isKeywordMessage('Band karo', ['band karo'])).toBe(true)
  })

  it('stays quiet while staff have the chat, and speaks again after 2 silent hours', async () => {
    await f.db
      .update(conversations)
      .set({ mode: 'human', humanUntil: new Date(MONDAY_11AM_IST.getTime() + 60_000) })
    const turn = await f.inbound('hello?')
    expect(await decideReply(deps(null), turn)).toEqual({ kind: 'silent', reason: 'human_mode' })

    await f.db
      .update(conversations)
      .set({ humanUntil: new Date(MONDAY_11AM_IST.getTime() - 60_000) })
    expect((await decideReply(deps(null), turn)).kind).toBe('handoff') // back in bot flow (no AI → handoff)
  })

  it('reactions and locations get no reply', async () => {
    expect(
      await decideReply(deps(null), await f.inbound('👍', { type: 'reaction' })),
    ).toMatchObject({ kind: 'silent' })
  })
})

describe('menu and clarifying', () => {
  it('greets with the main menu, no answer model needed', async () => {
    const smart = scripted({ text: 'unused' })
    const d = await decideReply(
      deps(models(router({ intent: 'greeting', language: 'hinglish', script: 'latin' }), smart)),
      await f.inbound('namaste'),
    )
    expect(d).toMatchObject({
      kind: 'reply',
      content: {
        kind: 'buttons',
        buttons: [{ title: 'Courses dekhein' }, { title: 'Free demo' }, { title: 'Baat karein' }],
      },
    })
    expect(smart.doGenerateCalls).toHaveLength(0)
  })

  it("uses the owner's button titles from bot settings", async () => {
    await f.db.update(botConfigs).set({
      mainMenu: [{ id: 'menu_demo', title: { hinglish: 'Demo class lein' } }],
    })
    const d = await decideReply(
      deps(
        models(
          router({ intent: 'greeting', language: 'hinglish', script: 'latin' }),
          scripted({ text: 'x' }),
        ),
      ),
      await f.inbound('hello'),
    )
    expect(d).toMatchObject({
      content: {
        buttons: [
          { title: 'Courses dekhein' },
          { title: 'Demo class lein' },
          { title: 'Baat karein' },
        ],
      },
    })
  })

  it('asks once when nothing makes sense, then hands over on the second miss', async () => {
    const m = models(
      router({ intent: 'other', confidence: 0.2, language: 'hinglish', script: 'latin' }),
      scripted({ text: 'x' }),
    )
    const first = await decideReply(deps(m), await f.inbound('asdf qwer'))
    expect(first).toMatchObject({ kind: 'reply', clarifyMisses: 1 })

    await f.db.update(conversations).set({ flowState: { clarifyMisses: 1 } })
    const second = await decideReply(deps(m), await f.inbound('zxcv'))
    expect(second).toMatchObject({ kind: 'handoff', reason: 'low_confidence', unanswered: 'zxcv' })
  })
})

describe('retrieval feeds the answer', () => {
  it("puts the institute's own document text in the prompt, and it counts as a source for numbers", async () => {
    const [source] = await f.db
      .insert(knowledgeSources)
      .values({ orgId: f.org.id, type: 'faq', title: 't', status: 'ready' })
      .returning()
    const content = 'Q: Lab mein kitne computer hain?\nA: Lab mein 40 computer hain.'
    const [vec] = (await hashEmbedding().doEmbed({ values: [content] })).embeddings
    await f.db
      .insert(knowledgeChunks)
      .values({ orgId: f.org.id, sourceId: source!.id, content, embedding: vec! })

    const smart = scripted({
      text: 'Lab mein 40 computer hain, har student ko apna computer milta hai.',
    })
    const turn = await f.inbound('lab mein kitne computer hain?')
    const d = await decideReply(
      deps(
        models(
          router({ intent: 'other', confidence: 0.8, language: 'hinglish', script: 'latin' }),
          smart,
        ),
      ),
      turn,
    )
    expect(d.kind).toBe('reply')
    if (d.kind === 'reply') expect(d.trace.retrievedChunkIds).toHaveLength(1)
    expect(JSON.stringify(smart.doGenerateCalls[0]!.prompt)).toContain('Lab mein 40 computer hain')
  })
})
