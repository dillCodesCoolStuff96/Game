// Vercel server function: Claude judges the drawings for the question on the
// TV. Called by the host's TV with their Supabase sign-in; the Anthropic key
// (ANTHROPIC_API_KEY) lives only in Vercel's environment variables.
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

// Judging several photos can take a little while.
export const config = { maxDuration: 60 }

const anthropic = new Anthropic()

const SYSTEM = `You are the judge of a drawing contest at a family Christmas party.
Each team had a few minutes to draw a prompt on paper with whatever pens were around, then
took a photo of it. Judge every drawing on how well it captures the prompt, creativity,
effort and how funny it is. These are amateurs, so judge them against each other, not
against professional art, and use the whole 1-10 range so there is a clear winner.
For each drawing write one short, playful roast or compliment (under 20 words) that the
room will enjoy hearing read aloud on the TV. Keep it kind and family-friendly.`

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          drawing: { type: 'integer', description: 'The drawing number from the labels' },
          score: { type: 'integer', description: 'Score from 1 to 10' },
          comment: { type: 'string' },
        },
        required: ['drawing', 'score', 'comment'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' })

  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  const { roomId } = req.body ?? {}
  if (!token || !roomId) return res.status(400).json({ error: 'Missing sign-in or game' })
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'The AI judge is not set up yet (no API key on Vercel)' })
  }

  // Act as the signed-in host, so the database's own rules decide what we can read.
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  })

  const { data: room } = await supabase
    .from('rooms')
    .select('id, buzz_round, current_question_id, allplay')
    .eq('id', roomId)
    .maybeSingle()
  // Only the board's owner can read the question, so this also checks it's the host.
  const { data: question } = room?.current_question_id
    ? await supabase
        .from('questions')
        .select('prompt, kind')
        .eq('id', room.current_question_id)
        .maybeSingle()
    : { data: null }
  if (!room || question?.kind !== 'drawing') {
    return res.status(403).json({ error: 'Only the host can judge, during a drawing question' })
  }

  const { data: drawings, error: drawingsError } = await supabase
    .from('drawings')
    .select('id, image_url, team_id, teams(name)')
    .eq('room_id', roomId)
    .eq('round', room.buzz_round)
    .order('id')
  if (drawingsError) return res.status(500).json({ error: drawingsError.message })
  if (!drawings.length) return res.status(400).json({ error: 'No drawings were submitted' })

  const content = [
    { type: 'text', text: `The prompt was: "${question.prompt}"` },
    ...drawings.flatMap((d, i) => [
      { type: 'text', text: `Drawing ${i + 1} (team "${d.teams?.name ?? 'Unknown'}"):` },
      { type: 'image', source: { type: 'url', url: d.image_url } },
    ]),
    { type: 'text', text: 'Score every drawing.' },
  ]

  let response
  try {
    response = await anthropic.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      // If the request is ever declined, the API retries it on a fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: VERDICT_SCHEMA },
      },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    })
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return res.status(500).json({ error: 'The Anthropic API key on Vercel is not valid' })
    }
    if (error instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'The AI judge is busy, try again in a moment' })
    }
    if (error instanceof Anthropic.APIError) {
      return res.status(502).json({ error: `AI judge error: ${error.message}` })
    }
    throw error
  }

  if (response.stop_reason === 'refusal') {
    return res.status(422).json({ error: 'The AI judge declined to score these drawings' })
  }
  const text = response.content.find((block) => block.type === 'text')?.text
  let verdicts
  try {
    verdicts = JSON.parse(text).verdicts
  } catch {
    return res.status(502).json({ error: 'The AI judge gave an answer the game could not read' })
  }

  // Map "Drawing N" back to the drawing rows.
  const saved = verdicts
    .filter((v) => drawings[v.drawing - 1])
    .map((v) => ({
      id: drawings[v.drawing - 1].id,
      score: Math.min(10, Math.max(1, Math.round(v.score))),
      comment: v.comment,
    }))
  const { error: saveError } = await supabase.rpc('save_drawing_verdicts', {
    p_room_id: roomId,
    p_verdicts: saved,
  })
  if (saveError) return res.status(500).json({ error: saveError.message })

  return res.status(200).json({ verdicts: saved })
}
