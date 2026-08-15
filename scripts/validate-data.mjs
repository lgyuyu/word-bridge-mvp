import { readFile } from "node:fs/promises";

const data = JSON.parse(await readFile(new URL("../data/gaokao-30-cards-v0.1.json", import.meta.url), "utf8"));
const cards = data.cards ?? [];
const required = [
  "id",
  "target",
  "meaning",
  "anchor",
  "transform",
  "bridge",
  "recall_prompt",
  "fact_boundary",
  "evidence_level",
  "example",
  "review_schedule_minutes"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(cards.length === 30, `expected 30 cards, received ${cards.length}`);
assert(new Set(cards.map(card => card.id)).size === cards.length, "card ids must be unique");
assert(new Set(cards.map(card => card.target)).size === cards.length, "target words must be unique");

for (const card of cards) {
  for (const field of required) assert(card[field] !== undefined && card[field] !== "", `${card.id} is missing ${field}`);
  assert(Array.isArray(card.anchor_candidates) && card.anchor_candidates.length > 0, `${card.id} has no familiar-word entry`);
  assert(card.anchor_candidates.some(candidate => candidate.word === card.anchor), `${card.id} primary familiar word is missing from candidates`);
  assert(JSON.stringify(card.review_schedule_minutes) === "[10,1440,10080]", `${card.id} has an unexpected review schedule`);
  assert(["L1", "L2", "M1"].includes(card.evidence_level), `${card.id} has an invalid evidence level`);
  assert(card.rights_status === "rewritten_original", `${card.id} is not cleared for this release`);
  assert(card.content_status === "ready_for_mvp", `${card.id} is not ready for the MVP`);
}

console.log(JSON.stringify({
  status: "ok",
  module: data.module_id,
  cards: cards.length,
  evidence: data.evidence_summary
}, null, 2));
