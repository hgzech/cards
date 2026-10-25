/**
 * The prompt that turns a marked page into cards. The single place it lives.
 *
 * Bump PROMPT_VERSION on every change: each card stores the version that made
 * it, so cards from different prompts can be told apart and compared later.
 *
 * History
 * - toy-1 (25 Oct 2026): copied verbatim from ~/Projects/highlights-toy
 *   (prompt.txt with CONVENTION from run.py filled in). Got 3/3 real Wundt
 *   photos right with Gemini 3.5 Flash-Lite in the toy.
 */
export const PROMPT_VERSION = 'toy-1'

/** The marking system. Later a per-user setting; for now fixed. */
export const CONVENTION =
  'Circling text makes a card; the circled text is the answer. One card per circle by default. ' +
  'Handwritten notes next to a circle, or a bracket grouping circles, are instructions: they say what ' +
  'the card should ask or how many cards to make. Underlines, highlights, exclamation marks and other ' +
  'marks are ordinary reading marks.'

const TEMPLATE = `You turn the reader's marks on a book or paper page into flashcards for a spaced-repetition app.

The reader's marking system:
{convention}

How to apply it:
- Look carefully at the handwriting on the page before you write anything: which words are circled, which circles belong together, and what any handwritten notes in the margin or next to a circle say.
- The circled text is the answer. Build the question from the sentence around it.
- A handwritten note is an instruction from the reader, never content for a card itself. It can say what the card should ask (e.g. "1st assistant" means ask who the first assistant was), or how many cards to make (e.g. "1C", "one card", or a bracket around several circles means a single card that asks for all of them). The note wins over your own idea of the question.
- Without a note: one card per circle.
- Marks that are not part of the system (underlines, highlights, exclamation marks, ticks, other scribbles) are the reader's ordinary reading marks. Ignore them completely, even if the passage looks important.

Writing the cards:
- The question must make sense on its own, months later, without the page. Name the person or thing; no pronouns without an antecedent, no "according to the text".
- Answers short enough to say out loud.
- Use only what is on the page. Never add facts from your own knowledge.
- Write the cards in the language of the page.
- For every card, copy the sentence (or part of it) that contains the circled answer verbatim into "quote".
- If nothing on the page is circled, return an empty list.
`

export const SYSTEM_PROMPT = TEMPLATE.replace('{convention}', CONVENTION)

/** The user turn that goes with the image. Same as the toy. */
export const USER_TEXT = 'Make the cards for this page.'

export const CARD_SCHEMA = {
  type: 'object',
  required: ['cards'],
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        required: ['front', 'back', 'quote'],
        properties: {
          front: { type: 'string' },
          back: { type: 'string' },
          quote: { type: 'string' },
        },
      },
    },
  },
}
