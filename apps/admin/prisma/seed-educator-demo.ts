/**
 * Seed Educator Demo Data
 *
 * Creates realistic test data for the Educator Studio:
 *   - 2 schools (Oakwood Primary, St Mary's CE Primary)
 *   - 2 subjects: Creative Comprehension + SPAG
 *   - 12 parameters (8 CC + 4 SPAG)
 *   - 8 teachers (Users + Callers)
 *   - 6 classrooms (CohortGroups)
 *   - 180 pupils (30 per class)
 *   - ~850 calls with realistic transcripts
 *   - ~5000+ CallScores
 *   - ~600 CallerMemories
 *   - ~140 CallerPersonalityProfiles
 *   - ~400 Goals
 *
 * Idempotent: tagged with "educator-demo" source markers.
 *
 * Prerequisites:
 *   - Database migrated (npx prisma migrate dev)
 *
 * Usage:
 *   npx tsx prisma/seed-educator-demo.ts
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

let prisma: PrismaClient;

// ══════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════

interface SchoolDef {
  slug: string;
  name: string;
  description: string;
  onboardingWelcome: string;
}

interface TeacherDef {
  firstName: string;
  lastName: string;
  email: string;
  schoolSlug: string;
  userRole: "ADMIN" | "EDUCATOR";
  className: string | null; // null = head teacher (no class)
}

interface TranscriptTemplate {
  id: string;
  subject: "CC" | "SPAG";
  title: string;
  parameters: string[]; // parameterId values scored for this template
  variants: Record<"high" | "onTrack" | "developing" | "support", string>;
}

type Band = "high" | "onTrack" | "developing" | "support";

// ══════════════════════════════════════════════════════════
// SCHOOLS
// ══════════════════════════════════════════════════════════

const SCHOOLS: SchoolDef[] = [
  {
    slug: "oakwood-primary",
    name: "Oakwood Primary School",
    description:
      "Established primary school in suburban setting. Strong commitment to literacy and 11+ preparation.",
    onboardingWelcome:
      "Welcome to Oakwood Primary! Our AI tutors help Year 5 pupils develop strong comprehension and language skills ready for their 11+ exams.",
  },
  {
    slug: "st-marys-ce-primary",
    name: "St Mary's CE Primary School",
    description:
      "Church of England primary school with excellent pastoral care. Focus on creative reading and SPAG mastery.",
    onboardingWelcome:
      "Welcome to St Mary's! We use AI-assisted practice sessions to help each child grow in confidence with reading comprehension and grammar.",
  },
];

// ══════════════════════════════════════════════════════════
// SUBJECTS & PARAMETERS
// ══════════════════════════════════════════════════════════

const SUBJECTS = [
  {
    slug: "creative-comprehension",
    name: "Creative Comprehension",
    description:
      "11+ exam preparation covering inference, retrieval, cross-source analysis, literary devices, PEA technique, vocabulary, summarising, and opinion forming across fiction, non-fiction, poetry, and multi-source materials.",
    qualificationBody: "GL Assessment / CEM",
    qualificationLevel: "Key Stage 2 (11+)",
  },
  {
    slug: "spag",
    name: "Spelling, Punctuation and Grammar",
    description:
      "Key Stage 2 SPAG covering spelling rules and statutory word lists, punctuation conventions, grammar fundamentals, and sentence structure from simple to complex.",
    qualificationBody: "National Curriculum",
    qualificationLevel: "Key Stage 2",
  },
];

const CC_PARAMETERS = [
  {
    parameterId: "CC-INFERENCE",
    name: "Inference Skills",
    definition:
      "Reading between the lines, deducing hidden meanings, interpreting author intent from implicit textual clues.",
    interpretationHigh: "Confidently identifies implied meanings and draws well-supported inferences from subtle textual clues.",
    interpretationLow: "Struggles to move beyond literal interpretation; needs prompting to consider what text implies.",
    sectionId: "creative-comprehension",
    domainGroup: "comprehension",
  },
  {
    parameterId: "CC-RETRIEVAL",
    name: "Information Retrieval",
    definition:
      "Locating explicit facts from text, maps, charts, images, and other source materials quickly and accurately.",
    interpretationHigh: "Rapidly and accurately locates specific information across multiple source types.",
    interpretationLow: "Overlooks key details, struggles to scan efficiently, often gives incomplete answers.",
    sectionId: "creative-comprehension",
    domainGroup: "comprehension",
  },
  {
    parameterId: "CC-CROSS-SRC",
    name: "Cross-Source Analysis",
    definition:
      "Comparing, contrasting, and synthesising information across multiple source types (text, maps, charts, images).",
    interpretationHigh: "Seamlessly connects evidence across sources and explains how they complement or contradict each other.",
    interpretationLow: "Treats each source in isolation; does not compare or synthesise across materials.",
    sectionId: "creative-comprehension",
    domainGroup: "comprehension",
  },
  {
    parameterId: "CC-LITERARY",
    name: "Literary Devices",
    definition:
      "Identifying and explaining metaphor, simile, personification, alliteration, onomatopoeia, and their effects on the reader.",
    interpretationHigh: "Accurately names literary techniques and explains their effect on the reader with supporting quotation.",
    interpretationLow: "Cannot identify common literary devices or confuses them; does not discuss their purpose.",
    sectionId: "creative-comprehension",
    domainGroup: "comprehension",
  },
  {
    parameterId: "CC-VOCAB",
    name: "Contextual Vocabulary",
    definition:
      "Defining unfamiliar words from surrounding context, using morphology and semantic clues.",
    interpretationHigh: "Uses context clues, root words, and affixes to accurately define unfamiliar vocabulary.",
    interpretationLow: "Unable to work out meanings from context; guesses randomly or leaves blank.",
    sectionId: "creative-comprehension",
    domainGroup: "comprehension",
  },
  {
    parameterId: "CC-PEA",
    name: "PEA Technique",
    definition:
      "Structuring written answers using Point-Evidence-Analysis paragraphs with clear reasoning chains.",
    interpretationHigh: "Writes well-structured PEA paragraphs with a clear point, relevant quotation, and insightful analysis.",
    interpretationLow: "Answers lack structure; gives opinions without evidence or explains quotes without making a point.",
    sectionId: "creative-comprehension",
    domainGroup: "comprehension",
  },
  {
    parameterId: "CC-SUMMARY",
    name: "Summarising",
    definition:
      "Concisely capturing main ideas in own words, distinguishing key points from supporting detail.",
    interpretationHigh: "Produces clear, concise summaries capturing all key points without unnecessary detail.",
    interpretationLow: "Retells everything or misses the main idea; cannot distinguish important from trivial.",
    sectionId: "creative-comprehension",
    domainGroup: "comprehension",
  },
  {
    parameterId: "CC-OPINION",
    name: "Forming Opinions",
    definition:
      "Developing and justifying personal interpretations with textual evidence and reasoned argument.",
    interpretationHigh: "Forms well-reasoned personal opinions supported by specific textual evidence and clear argument.",
    interpretationLow: "Gives unsupported opinions ('I liked it') or cannot distinguish opinion from fact.",
    sectionId: "creative-comprehension",
    domainGroup: "comprehension",
  },
];

const SPAG_PARAMETERS = [
  {
    parameterId: "SPAG-SPELL",
    name: "Spelling",
    definition:
      "Accuracy with common and statutory word lists, spelling patterns, prefixes, suffixes, and exceptions.",
    interpretationHigh: "Spells Year 5/6 statutory words accurately and applies spelling rules consistently.",
    interpretationLow: "Frequent errors on common words; does not apply spelling rules or patterns.",
    sectionId: "spag",
    domainGroup: "language",
  },
  {
    parameterId: "SPAG-PUNCT",
    name: "Punctuation",
    definition:
      "Correct use of commas, apostrophes, speech marks, colons, semicolons, and parenthetical punctuation.",
    interpretationHigh: "Uses a full range of punctuation accurately, including semicolons and parenthetical commas.",
    interpretationLow: "Relies on full stops only; misuses or omits commas, apostrophes, and speech marks.",
    sectionId: "spag",
    domainGroup: "language",
  },
  {
    parameterId: "SPAG-GRAM",
    name: "Grammar",
    definition:
      "Verb tenses, subject-verb agreement, word classes, active/passive voice, and modal verbs.",
    interpretationHigh: "Demonstrates secure grammar knowledge including passive voice, modals, and subjunctive.",
    interpretationLow: "Inconsistent tense usage, subject-verb disagreement, limited word class awareness.",
    sectionId: "spag",
    domainGroup: "language",
  },
  {
    parameterId: "SPAG-SENT",
    name: "Sentence Structure",
    definition:
      "Constructing simple, compound, and complex sentences with subordinate clauses and varied openers.",
    interpretationHigh: "Writes varied sentence types with embedded clauses, relative clauses, and fronted adverbials.",
    interpretationLow: "Uses only simple sentences; does not attempt compound or complex structures.",
    sectionId: "spag",
    domainGroup: "language",
  },
];

// ══════════════════════════════════════════════════════════
// TEACHERS
// ══════════════════════════════════════════════════════════

const TEACHERS: TeacherDef[] = [
  // Oakwood Primary
  { firstName: "Sarah", lastName: "Thompson", email: "s.thompson@oakwood.sch.uk", schoolSlug: "oakwood-primary", userRole: "ADMIN", className: null },
  { firstName: "James", lastName: "Chen", email: "j.chen@oakwood.sch.uk", schoolSlug: "oakwood-primary", userRole: "EDUCATOR", className: "5A" },
  { firstName: "Amara", lastName: "Okonkwo", email: "a.okonkwo@oakwood.sch.uk", schoolSlug: "oakwood-primary", userRole: "EDUCATOR", className: "5B" },
  { firstName: "Eleanor", lastName: "Davies", email: "e.davies@oakwood.sch.uk", schoolSlug: "oakwood-primary", userRole: "EDUCATOR", className: "5C" },
  // St Mary's CE Primary
  { firstName: "David", lastName: "Williams", email: "d.williams@stmarys.sch.uk", schoolSlug: "st-marys-ce-primary", userRole: "ADMIN", className: null },
  { firstName: "Priya", lastName: "Patel", email: "p.patel@stmarys.sch.uk", schoolSlug: "st-marys-ce-primary", userRole: "EDUCATOR", className: "Year 5 Oak" },
  { firstName: "Thomas", lastName: "O'Brien", email: "t.obrien@stmarys.sch.uk", schoolSlug: "st-marys-ce-primary", userRole: "EDUCATOR", className: "Year 5 Ash" },
  { firstName: "Jessica", lastName: "Martinez", email: "j.martinez@stmarys.sch.uk", schoolSlug: "st-marys-ce-primary", userRole: "EDUCATOR", className: "Year 5 Elm" },
];

// ══════════════════════════════════════════════════════════
// PUPIL NAME POOLS (7 classrooms × 30 names)
// ══════════════════════════════════════════════════════════

const PUPIL_POOLS: string[][] = [
  // Pool 0: Oakwood 5A
  [
    "Aisha Khan", "Oliver Smith", "Maya Patel", "Noah Williams", "Zara Ahmed",
    "Leo Chen", "Mia Thompson", "Ethan Davies", "Sofia Rodriguez", "Jack O'Connor",
    "Amelia Brown", "Liam Murphy", "Emily Wilson", "Mohammed Ali", "Grace Taylor",
    "Charlie Evans", "Freya Anderson", "Kai Zhang", "Ruby Clarke", "Oscar Wright",
    "Isla Campbell", "Ravi Singh", "Ella Martinez", "Lucas Green", "Chloe Harris",
    "Ryan Kelly", "Jasmine Walker", "Finlay Scott", "Ava Lewis", "Connor Hughes",
  ],
  // Pool 1: Oakwood 5B
  [
    "Hannah Baker", "Daniel Okonkwo", "Lily Chen", "Joshua Taylor", "Fatima Hussain",
    "George Mitchell", "Sophie Turner", "Adam Richardson", "Isabelle Cooper", "Tyler Brooks",
    "Eva Kowalski", "Sam Peterson", "Nadia Ibrahim", "Harry Phillips", "Maisie Wood",
    "Joseph Brennan", "Amber Singh", "Cameron Lee", "Scarlett Murray", "Dylan Thomas",
    "Layla Noor", "Alex Foster", "Sienna Quinn", "Nathan Clarke", "Poppy Wells",
    "Marcus Reid", "Daisy Atkins", "Luke Marshall", "Rosie Sharma", "Ollie Dunn",
  ],
  // Pool 2: Oakwood 5C
  [
    "Erin O'Neill", "Jayden Mensah", "Olivia Hunt", "Aiden Cooper", "Priya Sharma",
    "Felix Howard", "Imogen Cross", "Luca Rossi", "Bethany Grant", "Caleb Stone",
    "Hafsa Begum", "William Fox", "Tia Sinclair", "Owen Butler", "Alicia Fernandez",
    "Theo Dawson", "Millie Watson", "Reece Chambers", "Eliza Booth", "Kofi Agyeman",
    "Phoebe Hart", "Jake Russell", "Anaya Mirza", "Declan Flynn", "Holly Simpson",
    "Rohan Kapoor", "Georgia Lane", "Archie West", "Naomi Price", "Callum Byrne",
  ],
  // Pool 3: St Mary's Year 5 Oak
  [
    "Aaliyah Johnson", "Freddie Barnes", "Megan Lloyd", "Ibrahim Hassan", "Esme Fitzgerald",
    "Ben Crawford", "Leah Dixon", "Joshua Young", "Caitlin Reeves", "Max Thornton",
    "Yusra Malik", "Alfie Pearce", "Abigail Harper", "Kian O'Sullivan", "Martha Howe",
    "Zain Chaudhry", "Florence Parker", "Stanley Morris", "Niamh Kelly", "Jay Adebayo",
    "Darcey Frost", "Patrick Walsh", "Alina Nowak", "Hugo Stephens", "Ellie Mason",
    "Tom Gallagher", "Hannah Roberts", "Aaron James", "Violet Payne", "Rhys Morgan",
  ],
  // Pool 4: St Mary's Year 5 Ash
  [
    "Amelie Stewart", "Toby Richards", "Sara Bhasin", "James Doyle", "Lucy Warren",
    "Kayden Barrett", "Emma Griffiths", "Daniel Knight", "Jessica Lam", "Harry Shaw",
    "Mariam Osman", "Archie McDonald", "Beth Allen", "Ethan Holt", "Tilly Curtis",
    "Hamza Sheikh", "Pippa Watts", "Luke Gregory", "Amy Nicholls", "Oliver Jordan",
    "Zainab Dar", "Finn McCarthy", "Evie Gibson", "Charlie Barker", "Seren Edwards",
    "Jude Palmer", "Molly Saunders", "Isaac Lawson", "Willow Spencer", "Ben Tucker",
  ],
  // Pool 5: St Mary's Year 5 Elm
  [
    "Charlotte Page", "Ryan Ahmed", "Alice Henderson", "Samuel Kirk", "Iris Coleman",
    "Tyler Watts", "Gracie Morton", "Noah Pratt", "Heidi Bates", "Elliot Townsend",
    "Hana Yusuf", "Jake Chapman", "Matilda Perry", "Louie Carr", "Evelyn Drake",
    "Amir Rashid", "Daisy Meredith", "Toby Francis", "Skye O'Donnell", "Caleb White",
    "Anais Dubois", "Harrison Blake", "Flora Gibbs", "Leo Hayward", "Ruby Lambert",
    "Yousef Saleh", "Mabel Owens", "Rory MacLeod", "Summer Ellis", "Jack Barton",
  ],
];

// ══════════════════════════════════════════════════════════
// CLASSROOM → POOL MAPPING
// ══════════════════════════════════════════════════════════

const CLASSROOMS = [
  { name: "5A", schoolSlug: "oakwood-primary", poolIndex: 0 },
  { name: "5B", schoolSlug: "oakwood-primary", poolIndex: 1 },
  { name: "5C", schoolSlug: "oakwood-primary", poolIndex: 2 },
  { name: "Year 5 Oak", schoolSlug: "st-marys-ce-primary", poolIndex: 3 },
  { name: "Year 5 Ash", schoolSlug: "st-marys-ce-primary", poolIndex: 4 },
  { name: "Year 5 Elm", schoolSlug: "st-marys-ce-primary", poolIndex: 5 },
];

// ══════════════════════════════════════════════════════════
// TRANSCRIPT TEMPLATES (5 CC + 3 SPAG × 4 quality variants)
// ══════════════════════════════════════════════════════════

const TRANSCRIPT_TEMPLATES: TranscriptTemplate[] = [
  // ── CC-1: Multi-Source Analysis (Great Fire of London) ──
  {
    id: "CC-1",
    subject: "CC",
    title: "Multi-Source Analysis: Great Fire of London",
    parameters: ["CC-RETRIEVAL", "CC-CROSS-SRC", "CC-INFERENCE"],
    variants: {
      high: `AI: Good morning, {{name}}! Today we're going to look at the Great Fire of London using several different sources — a diary extract, a map, and a timeline chart. Let's start with the diary. What can you tell me about when the fire started?
User: Samuel Pepys says the fire started on Sunday 2nd September 1666 in the early hours. He was woken by his maid.
AI: Excellent retrieval! Now look at the map. Where did the fire begin?
User: The map shows it started in Pudding Lane, near the bakery of Thomas Farriner. I can see from the shaded area that it spread mostly to the west and north because the wind was blowing that direction — which matches what Pepys describes about the easterly wind.
AI: Brilliant — you've connected the map evidence with the diary. That's really strong cross-source analysis. Now, looking at the timeline chart, what pattern do you notice about the spread?
User: The chart shows the fire grew fastest on Monday and Tuesday. By Wednesday it was slowing down. I think that's because the King ordered houses to be pulled down to create firebreaks — Pepys mentions this too. So the sources all confirm each other.
AI: Outstanding work. You've retrieved specific details, cross-referenced across all three sources, and drawn a well-supported inference about the firebreaks. Let's try one more…`,
      onTrack: `AI: Good morning, {{name}}! Today we're looking at the Great Fire of London using a diary extract, a map, and a timeline. Let's start with the diary. When did the fire begin?
User: It says it started in September 1666. On a Sunday I think.
AI: Good — can you find the exact date?
User: September 2nd. Pepys was told about it by his maid.
AI: Well done. Now look at the map. Where did the fire start?
User: Pudding Lane. I can see the shaded bit showing where it burned.
AI: Can you tell from the map which direction it spread?
User: It looks like it went… to the left? Towards the river maybe? Oh wait, the key says west. Yes, it spread west.
AI: Good. Now can you connect that to anything in the diary?
User: Um, Pepys talks about wind. Maybe the wind pushed it west?
AI: Yes, that's a good connection between the two sources. Let's look at the timeline chart now…`,
      developing: `AI: Good morning, {{name}}! We're looking at the Great Fire of London today using three sources. Let's start with this diary extract. Can you tell me when the fire started?
User: Um, it was a long time ago. In London.
AI: That's right — can you find the date in the text?
User: 1666?
AI: Good! And what month?
User: September.
AI: Great. Now let's look at the map. Can you find Pudding Lane?
User: Is it this street here?
AI: That's right. The map shows us where the fire spread. Can you see the coloured area?
User: Yeah, there's a big orange bit.
AI: What does that orange area tell us?
User: That's where the fire was?
AI: Exactly. Good reading of the map. Let's see if we can find any more clues…`,
      support: `AI: Good morning, {{name}}! Today we're going to look at some interesting sources about the Great Fire of London. Let's start with this diary entry. Can you read the first sentence for me?
User: It's hard to read.
AI: That's okay — let me help. It says "I was woken in the night by my maid Jane." What do you think is happening?
User: Someone woke up?
AI: Yes! A man called Samuel Pepys was woken up because there was a fire. Can you find the word "fire" anywhere in the text?
User: Oh yeah, here.
AI: Well done! Now let's look at this map. Can you see the big coloured area?
User: Yes.
AI: That shows us where the fire burned. It's quite big, isn't it? Let's look at the next source…`,
    },
  },
  // ── CC-2: Inference & Literary Devices (The Iron Man) ──
  {
    id: "CC-2",
    subject: "CC",
    title: "Inference & Literary Devices: The Iron Man",
    parameters: ["CC-INFERENCE", "CC-LITERARY", "CC-VOCAB"],
    variants: {
      high: `AI: Today we're reading an extract from "The Iron Man" by Ted Hughes. Have a look at the opening paragraph. What mood does the author create?
User: It feels mysterious and quite dramatic. Hughes describes the Iron Man standing on the cliff edge in the darkness. The phrase "taller than a house" is a comparison — I think it's actually hyperbole because it makes him seem impossibly big and powerful.
AI: Excellent identification of hyperbole! What about the phrase "his eyes were like headlamps"?
User: That's a simile comparing his eyes to headlamps. It creates a really vivid image — it makes him seem mechanical and a bit scary because headlamps cut through darkness. It also suggests he can see far, which makes him seem powerful.
AI: Wonderful analysis of the effect. Now, what do you think the word "luminous" means in the phrase "luminous eyes"?
User: Well "lumen" is to do with light, so luminous must mean glowing or shining. It fits with the headlamp simile — his eyes are giving off light in the darkness.
AI: Perfect use of word roots. Your inference skills are really strong, {{name}}.`,
      onTrack: `AI: Today we're reading an extract from "The Iron Man" by Ted Hughes. What mood does the opening create?
User: It's a bit scary. The Iron Man is on a cliff in the dark.
AI: Good — what makes it feel scary?
User: He's really big. It says "taller than a house."
AI: What technique is the author using there?
User: Is it a simile? Because it's comparing him to a house?
AI: It's actually a slightly different technique — it's exaggeration to make him seem impossibly large. We call that hyperbole. What about "his eyes were like headlamps"?
User: That's a simile because it uses "like."
AI: Correct! Why does Hughes compare his eyes to headlamps?
User: Because they're bright? And kind of round?
AI: Good start. What does the word "luminous" mean — can you guess from the context?
User: Shiny maybe? Like glowing?
AI: Yes, well done. The context gives us good clues.`,
      developing: `AI: Today we're reading about the Iron Man by Ted Hughes. Let's read the first paragraph together. What do you notice about the Iron Man?
User: He's really big.
AI: Yes! The author says he's "taller than a house." Why do you think Hughes says that?
User: Because he's tall?
AI: Right — and it helps us picture just how enormous he is. Now, it says "his eyes were like headlamps." What are headlamps?
User: The lights on a car?
AI: Exactly. So what is the author telling us about the Iron Man's eyes?
User: They're bright?
AI: Good. When an author says something is "like" something else, that's called a simile. Can you spot any other describing words?
User: Um… "luminous"?
AI: Great word to pick out! What do you think it might mean?
User: I'm not sure.`,
      support: `AI: Hello {{name}}! Today we're going to read about a very interesting character called the Iron Man. Let me read the first bit to you. "The Iron Man stood on the cliff edge, taller than a house." Can you tell me one thing about him?
User: He's on a cliff.
AI: Good listening! And he's very, very tall — the author says "taller than a house." That's so big! What do you think he looks like?
User: Made of metal?
AI: Yes — he's made of iron, like his name! The story says "his eyes were like headlamps." Do you know what headlamps are?
User: No.
AI: They're the big bright lights on the front of a car. So his eyes are very bright and shiny. Let's keep reading…`,
    },
  },
  // ── CC-3: PEA Technique (Charlotte's Web) ──
  {
    id: "CC-3",
    subject: "CC",
    title: "PEA Technique: Charlotte's Web",
    parameters: ["CC-PEA", "CC-OPINION"],
    variants: {
      high: `AI: We've been reading "Charlotte's Web." Today I want you to practise writing PEA paragraphs about Charlotte as a character. Why do you think Charlotte is a good friend to Wilbur?
User: Charlotte is an exceptionally loyal friend to Wilbur because she literally saves his life through her own creativity. We can see this when she writes "SOME PIG" in her web — this shows she's willing to use her own skills and energy to protect him. The fact that she works through the night weaving these words suggests that her friendship goes beyond words into real self-sacrifice. As a reader, I think this is especially powerful because Charlotte knows she will die soon, which makes her actions even more selfless.
AI: That's an outstanding PEA paragraph, {{name}}! You made a clear point about loyalty, provided a specific quotation as evidence, and your analysis explored the deeper meaning of self-sacrifice. You even added a personal interpretation with "as a reader." Excellent work.
User: Thank you! I think Charlotte represents what real friendship looks like — it's about what you do, not what you say.
AI: That's a beautifully formed opinion supported by everything we've read. Shall we try another character?`,
      onTrack: `AI: Let's practise PEA paragraphs about Charlotte from "Charlotte's Web." Why is Charlotte a good friend?
User: Charlotte is a good friend because she helps Wilbur not get killed. She writes "SOME PIG" in her web to make people think Wilbur is special. This shows she cares about him a lot.
AI: Good start! You've got a point and some evidence. Can you add more analysis — why does this show she cares?
User: Because she didn't have to do it? She chose to help him even though it was hard work.
AI: Good. And what's your personal opinion about Charlotte?
User: I think she's really brave. She puts Wilbur first.
AI: Nice opinion. Try to link it back to the text next time — what specific moment shows bravery?`,
      developing: `AI: Let's talk about Charlotte from "Charlotte's Web." Is she a good friend to Wilbur?
User: Yes because she helps him.
AI: Good — can you tell me how she helps him?
User: She writes stuff in her web.
AI: Yes! She writes "SOME PIG." Remember our PEA technique? You need a Point, Evidence, and Analysis. Your point is that she's a good friend. Your evidence is that she writes in her web. Now for Analysis — why does she do that?
User: So people don't eat Wilbur?
AI: Exactly — she's trying to save his life. That shows real friendship. Can you put that all into one answer for me?
User: Charlotte is a good friend because she writes in her web to save Wilbur.
AI: Good — you've got the Point and Evidence. Next time, try adding "this shows that…" for your Analysis.`,
      support: `AI: Today we're going to talk about Charlotte the spider. Do you remember her from our story?
User: She's the spider.
AI: That's right! And who is her friend?
User: Wilbur the pig.
AI: Yes! Charlotte does something very special for Wilbur. Do you remember what?
User: She makes a web?
AI: She writes words in her web! She writes "SOME PIG." That's amazing, isn't it? Why do you think she does that?
User: To help Wilbur?
AI: Yes — she wants to keep Wilbur safe. That makes her a very good friend. Let's practise saying that: "Charlotte is a good friend because…"
User: Charlotte is a good friend because she helps Wilbur.
AI: Well done! That's a great start, {{name}}.`,
    },
  },
  // ── CC-4: Vocabulary in Context ──
  {
    id: "CC-4",
    subject: "CC",
    title: "Vocabulary in Context: Mystery Passages",
    parameters: ["CC-VOCAB", "CC-INFERENCE"],
    variants: {
      high: `AI: Today we're working on vocabulary in context. Here's a passage: "The ancient mariner gazed at the desolate landscape. Not a single verdant tree remained — only the parched, barren earth stretched to the horizon." What does "desolate" mean here?
User: Desolate means empty, bleak, and lifeless. I can tell because it says there are no green trees and the earth is parched and barren — all the describing words around it suggest something lifeless and deserted.
AI: Perfect use of context clues! What about "verdant"?
User: Verdant means green and lush — like full of plant life. I know this because the sentence contrasts it with "parched" and "barren," so verdant must be the opposite. Also, "verd" is like "verde" which means green in Spanish and French.
AI: Excellent — you've used both context and etymology! That's a really sophisticated vocabulary skill, {{name}}.`,
      onTrack: `AI: Let's work on vocabulary. Here's a passage: "The ancient mariner gazed at the desolate landscape. Not a single verdant tree remained." What does "desolate" mean?
User: Empty? Like nothing there?
AI: Good — what clues in the text helped you?
User: It says no trees remained and the earth is barren.
AI: Well done using context clues. What about "verdant"?
User: I'm not sure. Something about trees?
AI: Look at the sentence — "not a single verdant tree remained." What kind of tree would normally be there?
User: A green one? So verdant means green?
AI: Yes! Verdant means green and lush. Good reasoning.`,
      developing: `AI: Let's look at some tricky words today. "The desolate landscape stretched for miles." What do you think "desolate" means?
User: I don't know that word.
AI: Let's look for clues. The passage also says "parched" and "barren." Those words mean dry and empty. So what might desolate mean?
User: Dry?
AI: Close — it means empty and lifeless. Like a desert with nothing growing. Can you think of a place that might be desolate?
User: A desert?
AI: Yes, great example!`,
      support: `AI: Today we're going to be word detectives, {{name}}! Let's look at this sentence: "The garden was desolate." What do you think the garden looked like?
User: I don't know.
AI: That's okay. The next sentence says "no flowers, no grass, just bare mud." So what do you think desolate means?
User: No flowers?
AI: Yes — desolate means empty and bare. Nothing growing. Can you say "the garden was desolate — it was empty"?
User: The garden was desolate, it was empty.
AI: Well done! You're learning to use the other words to help you guess.`,
    },
  },
  // ── CC-5: Summarising & Themes (The Tunnel by Browne) ──
  {
    id: "CC-5",
    subject: "CC",
    title: "Summarising & Themes: The Tunnel",
    parameters: ["CC-SUMMARY", "CC-OPINION"],
    variants: {
      high: `AI: We've just finished reading "The Tunnel" by Anthony Browne. Can you summarise the story in three or four sentences?
User: "The Tunnel" is about a brother and sister who are very different and don't get along. The brother discovers a tunnel and crawls through it into a mysterious forest. When he gets lost and turns to stone, his sister bravely follows and rescues him by hugging the stone figure. After that they become closer and learn to appreciate each other.
AI: That's an excellent summary — you've captured the beginning, middle, and end without including unnecessary detail. What do you think the main theme is?
User: I think the main theme is that love between siblings can overcome any differences. The tunnel is a metaphor for the journey from conflict to understanding. Rose has to face her fears to save her brother, which shows that real love requires bravery. I also think Browne is saying that people who seem very different can still deeply care about each other.
AI: Brilliant thematic analysis, {{name}}! You've identified metaphor, character development, and authorial intent all in one response.`,
      onTrack: `AI: Can you summarise "The Tunnel" by Anthony Browne?
User: It's about a brother and sister. The boy goes through a tunnel and his sister has to go and save him. He turns to stone and she hugs him and he comes back.
AI: Good — you've got the key events. Can you add what happens at the beginning and end to make it a complete summary?
User: At the start they don't get on. And at the end they're friends.
AI: Good. What do you think the story is really about?
User: That family is important? Even if you're different you should still care about each other.
AI: That's a strong opinion. Can you point to a moment in the story that shows this?
User: When Rose hugs the stone. She's scared but she does it anyway.
AI: Great connection to the text.`,
      developing: `AI: Can you tell me what happened in "The Tunnel"?
User: There's a tunnel and a boy goes in it.
AI: Good start. What happens to him in the tunnel?
User: He gets lost? And turns to stone.
AI: Yes. And who helps him?
User: His sister.
AI: Right — and what does she do?
User: She hugs him.
AI: Yes — and he turns back. So can you tell me the whole story in a few sentences?
User: A boy goes in a tunnel and turns to stone and his sister saves him.
AI: Good — next time try to include how they felt at the beginning and end too.`,
      support: `AI: Do you remember the story we read, {{name}}? "The Tunnel"?
User: A bit.
AI: Let's go through it. There's a brother and a sister. Do they get along at the start?
User: No.
AI: Right. Then the boy finds a tunnel. What happens?
User: He goes in?
AI: Yes! And something happens to him. He turns to…
User: Stone?
AI: Yes! And his sister goes to help. She gives him a big hug and he turns back. What do you think the story is telling us?
User: Be nice to your brother?
AI: Something like that — family is important, even when we disagree. Well done for remembering.`,
    },
  },
  // ── SPAG-1: Punctuation ──
  {
    id: "SPAG-1",
    subject: "SPAG",
    title: "Punctuation: Commas, Speech Marks, Apostrophes",
    parameters: ["SPAG-PUNCT", "SPAG-SENT"],
    variants: {
      high: `AI: Today we're practising punctuation. Here's a sentence: "after eating the children went outside to play." Where does the comma go?
User: After "eating" — "After eating, the children went outside to play." Without the comma it sounds like someone is eating the children! The comma separates the subordinate clause from the main clause.
AI: Brilliant — you understand both the rule and the reason. Now, can you punctuate this speech: the teacher said put your books away children
User: "Put your books away, children," the teacher said. I need speech marks around what's said, a comma before "children" because it's direct address, and a comma before "the teacher said" because the speech continues into the reporting clause.
AI: Absolutely perfect, {{name}}. You've nailed speech punctuation and direct address commas.`,
      onTrack: `AI: Where does the comma go: "after eating the children went outside to play"?
User: After eating? "After eating, the children went outside to play."
AI: Correct! Why is the comma important there?
User: Because without it, it sounds weird. Like you're eating the children.
AI: Ha — exactly! The comma makes the meaning clear. Now punctuate this speech: the teacher said put your books away
User: "Put your books away," the teacher said. I put speech marks around what the teacher says.
AI: Good. Remember the comma inside the speech marks before the reporting clause. Well done.`,
      developing: `AI: Let's practise commas today. "after eating the children went outside." Where should we put a comma?
User: At the end?
AI: Not quite. Try reading it without a comma — "after eating the children"! We need to separate "after eating" from "the children." Where should the comma go?
User: After eating?
AI: Yes! "After eating, the children went outside." The comma shows that "after eating" is one idea and "the children" is the next part. Let's try another one.`,
      support: `AI: Today we're going to practise commas, {{name}}. A comma is like a little pause. Listen: "After eating <pause> the children went outside." Where do we put the comma?
User: I'm not sure.
AI: Let me show you: "After eating, the children went outside." The comma goes after "eating." Can you write that for me?
User: After eating, the children went outside.
AI: Well done! You put the comma in the right place. Let's try another one together.`,
    },
  },
  // ── SPAG-2: Spelling Patterns ──
  {
    id: "SPAG-2",
    subject: "SPAG",
    title: "Spelling: Patterns, Rules, Statutory Words",
    parameters: ["SPAG-SPELL"],
    variants: {
      high: `AI: Let's work on spelling patterns today. Can you spell "accommodate"?
User: A-C-C-O-M-M-O-D-A-T-E. It has double C and double M. I remember it because it's big enough to accommodate two C's and two M's!
AI: What a clever mnemonic! Now try "necessary."
User: N-E-C-E-S-S-A-R-Y. One C and double S. "One collar, two socks" — that's how I remember it.
AI: Excellent strategies. What about "conscience"?
User: C-O-N-S-C-I-E-N-C-E. It has "science" inside it, which helps me remember the tricky "sc" part.
AI: You've got brilliant spelling strategies, {{name}}. Using patterns and mnemonics like that will really help in the 11+.`,
      onTrack: `AI: Let's practise some tricky spellings. Can you spell "accommodate"?
User: A-C-O-M-O-D-A-T-E?
AI: Nearly! "Accommodate" needs double C and double M: A-C-C-O-M-M-O-D-A-T-E. It's big enough to fit two of each. Try "necessary."
User: N-E-C-E-S-S-A-R-Y.
AI: Perfect! How did you remember the double S?
User: My mum taught me "never eat cress, eat salmon sandwiches and remain young."
AI: Great mnemonic! Those really help with tricky words.`,
      developing: `AI: Let's practise our spellings. Can you spell "because"?
User: B-E-C-U-Z?
AI: Not quite. Let's break it into chunks: "be-cause." B-E-C-A-U-S-E. Can you try again?
User: B-E-C-A-U-S-E.
AI: Well done! Remember: "Big Elephants Can Always Understand Small Elephants." That might help you remember. Let's try "different."
User: D-I-F-F-R-E-N-T?
AI: Almost — you need an extra E: D-I-F-F-E-R-E-N-T. Listen to the syllables: "dif-fer-ent."`,
      support: `AI: Today we're going to practise some spellings together, {{name}}. Let's start with "said." Can you have a go?
User: S-E-D?
AI: Good try! It's actually S-A-I-D. "Said" is a tricky word because it doesn't sound like it looks. Let's write it three times together. S-A-I-D.
User: S-A-I-D. S-A-I-D. S-A-I-D.
AI: Wonderful! You'll remember that now. Let's try "they."
User: T-H-A-Y?
AI: Nearly — it's T-H-E-Y. The "ey" makes the same sound as "ay." Let's practise that one too.`,
    },
  },
  // ── SPAG-3: Grammar & Sentence Structure ──
  {
    id: "SPAG-3",
    subject: "SPAG",
    title: "Grammar & Sentence Structure",
    parameters: ["SPAG-GRAM", "SPAG-SENT"],
    variants: {
      high: `AI: Today we're looking at sentence types. Can you turn this simple sentence into a complex one? "The dog barked."
User: "The dog barked loudly whenever a stranger approached the gate, which startled the sleeping cat on the windowsill." I've added a subordinate clause with "whenever" and a relative clause with "which."
AI: That's excellent — you've created a multi-clause complex sentence. Can you identify the main clause?
User: "The dog barked loudly" is the main clause because it makes sense on its own. "Whenever a stranger approached the gate" is a subordinate clause because it can't stand alone — it depends on the main clause.
AI: Perfect understanding. Now, can you rewrite "The ball was kicked by the boy" in the active voice?
User: "The boy kicked the ball." The subject is now doing the action instead of receiving it.
AI: Outstanding grammar knowledge, {{name}}.`,
      onTrack: `AI: Can you make this sentence more complex? "The dog barked."
User: "The dog barked because someone knocked on the door."
AI: Good — you've added a reason clause with "because." Can you tell me which part is the main clause?
User: "The dog barked"?
AI: Yes! And "because someone knocked on the door" is the subordinate clause. Can you change "The ball was kicked by the boy" to active voice?
User: "The boy kicked the ball"?
AI: Perfect! In active voice, the subject does the action. Well done.`,
      developing: `AI: Let's look at sentences. "The dog barked." Can you make this longer?
User: The dog barked really loudly.
AI: Good — you've added an adverb. Can you add a reason? Why did the dog bark?
User: The dog barked because it heard a noise.
AI: Well done! You've made a compound sentence. "Because" joins the two ideas. The first part is the main bit, the second part tells us why.
User: Is that a complex sentence?
AI: Yes it is! Any sentence with "because," "when," "although," or "if" joining two parts is a complex sentence. Good question!`,
      support: `AI: Let's look at a sentence today, {{name}}. "The dog barked." That's a simple sentence. Can you add one more word to make it longer?
User: The big dog barked?
AI: Good — you added "big"! That's an adjective. Now, can you tell me who is doing the barking?
User: The dog?
AI: Yes! The dog is the subject. "Barked" is what the dog does — that's the verb. Subject and verb — every sentence needs both. Let's try another: "The cat ___." What might the cat do?
User: The cat slept?
AI: Great sentence! You've got a subject and a verb.`,
    },
  },
];

// ══════════════════════════════════════════════════════════
// PROGRESS BAND HELPERS
// ══════════════════════════════════════════════════════════

function getBand(position: number): Band {
  if (position <= 6) return "high";
  if (position <= 21) return "onTrack";
  if (position <= 27) return "developing";
  return "support";
}

function bandScoreRange(band: Band): [number, number] {
  switch (band) {
    case "high": return [0.75, 0.95];
    case "onTrack": return [0.45, 0.74];
    case "developing": return [0.25, 0.44];
    case "support": return [0.10, 0.24];
  }
}

function bandCallCount(band: Band): [number, number] {
  switch (band) {
    case "high": return [8, 12];
    case "onTrack": return [4, 7];
    case "developing": return [2, 4];
    case "support": return [0, 2];
  }
}

function bandGoalProgress(band: Band): [number, number] {
  switch (band) {
    case "high": return [0.65, 0.85];
    case "onTrack": return [0.35, 0.60];
    case "developing": return [0.15, 0.35];
    case "support": return [0.05, 0.20];
  }
}

/**
 * Deterministic pseudo-random using a seed string.
 * Returns a number between 0 and 1.
 */
function seededRandom(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const chr = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  // Convert to 0-1 range
  return (Math.abs(hash) % 10000) / 10000;
}

/** Get a value within [min, max] using a deterministic seed */
function seededRange(min: number, max: number, seed: string): number {
  return min + seededRandom(seed) * (max - min);
}

/** Get an integer within [min, max] inclusive using a deterministic seed */
function seededInt(min: number, max: number, seed: string): number {
  return Math.floor(seededRange(min, max + 0.99, seed));
}

/** Round to 2 decimal places */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ══════════════════════════════════════════════════════════
// CLEANUP
// ══════════════════════════════════════════════════════════

async function cleanupExistingData() {
  console.log("  Cleaning up existing educator-demo data...");

  const schoolSlugs = SCHOOLS.map((s) => s.slug);
  const teacherEmails = TEACHERS.map((t) => t.email);

  // 1. CallScores on demo calls
  const demoCalls = await prisma.call.findMany({
    where: { source: "educator-demo" },
    select: { id: true },
  });
  const demoCallIds = demoCalls.map((c) => c.id);

  if (demoCallIds.length > 0) {
    await prisma.callScore.deleteMany({
      where: { callId: { in: demoCallIds } },
    });
    await prisma.behaviorMeasurement.deleteMany({
      where: { callId: { in: demoCallIds } },
    });
    await prisma.callMessage.deleteMany({
      where: { callId: { in: demoCallIds } },
    });
  }

  // 2. Calls
  await prisma.call.deleteMany({
    where: { source: "educator-demo" },
  });

  // 3. Memories on demo callers
  const demoCallers = await prisma.caller.findMany({
    where: { externalId: { startsWith: "edu-demo-" } },
    select: { id: true },
  });
  const demoCallerIds = demoCallers.map((c) => c.id);

  if (demoCallerIds.length > 0) {
    await prisma.callerMemory.deleteMany({
      where: { callerId: { in: demoCallerIds } },
    });
    await prisma.callerMemorySummary.deleteMany({
      where: { callerId: { in: demoCallerIds } },
    });
    await prisma.callerPersonalityProfile.deleteMany({
      where: { callerId: { in: demoCallerIds } },
    });
    await prisma.goal.deleteMany({
      where: { callerId: { in: demoCallerIds } },
    });
    // CallerPlaybook enrollments (FK: callerId, playbookId)
    await prisma.callerPlaybook.deleteMany({
      where: { callerId: { in: demoCallerIds } },
    });
  }

  // 4. CohortPlaybook assignments (before CohortGroups and Playbooks)
  const demoCohorts = await prisma.cohortGroup.findMany({
    where: { domain: { slug: { in: schoolSlugs } } },
    select: { id: true },
  });
  if (demoCohorts.length > 0) {
    await prisma.cohortPlaybook.deleteMany({
      where: { cohortGroupId: { in: demoCohorts.map((c) => c.id) } },
    });
  }

  // 5. ComposedPrompts + ConversationArtifacts on demo callers (FK: callerId)
  if (demoCallerIds.length > 0) {
    await prisma.composedPrompt.deleteMany({
      where: { callerId: { in: demoCallerIds } },
    });
    await prisma.conversationArtifact.deleteMany({
      where: { callerId: { in: demoCallerIds } },
    });
    await prisma.callerIdentity.deleteMany({
      where: { callerId: { in: demoCallerIds } },
    });
  }

  // 5b. CallerCohortMembership — must come before Callers and CohortGroups
  if (demoCallerIds.length > 0) {
    await prisma.callerCohortMembership.deleteMany({
      where: { callerId: { in: demoCallerIds } },
    });
  }

  // 6. Callers (pupils) — must come before CohortGroups (FK: caller.cohortGroupId)
  await prisma.caller.deleteMany({
    where: { externalId: { startsWith: "edu-demo-" } },
  });

  // 7. CohortGroups — must come before teacher callers (FK: cohortGroup.ownerId)
  await prisma.cohortGroup.deleteMany({
    where: { domain: { slug: { in: schoolSlugs } } },
  });

  // 8. Teacher callers — clean FKs first
  const teacherCallers = await prisma.caller.findMany({
    where: { externalId: { startsWith: "edu-teacher-" } },
    select: { id: true },
  });
  const teacherCallerIds = teacherCallers.map((c) => c.id);
  if (teacherCallerIds.length > 0) {
    await prisma.composedPrompt.deleteMany({
      where: { callerId: { in: teacherCallerIds } },
    });
    await prisma.conversationArtifact.deleteMany({
      where: { callerId: { in: teacherCallerIds } },
    });
    await prisma.callerIdentity.deleteMany({
      where: { callerId: { in: teacherCallerIds } },
    });
  }
  await prisma.caller.deleteMany({
    where: { externalId: { startsWith: "edu-teacher-" } },
  });

  // 9. MediaAssets (CC worksheets) — SubjectMedia first, then MediaAsset (before Users due to FK: uploadedBy)
  const demoMedia = await prisma.mediaAsset.findMany({
    where: { contentHash: { startsWith: "edu-demo-" } },
    select: { id: true },
  });
  if (demoMedia.length > 0) {
    await prisma.subjectMedia.deleteMany({
      where: { mediaId: { in: demoMedia.map((m) => m.id) } },
    });
    await prisma.mediaAsset.deleteMany({
      where: { id: { in: demoMedia.map((m) => m.id) } },
    });
  }

  // 9. Users (teachers)
  // Delete accounts first (FK)
  const teacherUsers = await prisma.user.findMany({
    where: { email: { in: teacherEmails } },
    select: { id: true },
  });
  if (teacherUsers.length > 0) {
    await prisma.account.deleteMany({
      where: { userId: { in: teacherUsers.map((u) => u.id) } },
    });
    await prisma.session.deleteMany({
      where: { userId: { in: teacherUsers.map((u) => u.id) } },
    });
  }
  await prisma.user.deleteMany({
    where: { email: { in: teacherEmails } },
  });

  // 10. Content assertions → SubjectSources → ContentSources (demo-tagged)
  const demoSources = await prisma.contentSource.findMany({
    where: { slug: { startsWith: "edu-demo-" } },
    select: { id: true },
  });
  const demoSourceIds = demoSources.map((s) => s.id);
  if (demoSourceIds.length > 0) {
    await prisma.contentAssertion.deleteMany({
      where: { sourceId: { in: demoSourceIds } },
    });
    await prisma.subjectSource.deleteMany({
      where: { sourceId: { in: demoSourceIds } },
    });
  }
  await prisma.contentSource.deleteMany({
    where: { slug: { startsWith: "edu-demo-" } },
  });

  // 11. PlaybookItems → Playbooks (for demo schools)
  const demoPlaybooks = await prisma.playbook.findMany({
    where: { domain: { slug: { in: schoolSlugs } } },
    select: { id: true },
  });
  const demoPlaybookIds = demoPlaybooks.map((p) => p.id);
  if (demoPlaybookIds.length > 0) {
    await prisma.callerPlaybook.deleteMany({
      where: { playbookId: { in: demoPlaybookIds } },
    });
    await prisma.playbookItem.deleteMany({
      where: { playbookId: { in: demoPlaybookIds } },
    });
  }
  await prisma.playbook.deleteMany({
    where: { domain: { slug: { in: schoolSlugs } } },
  });

  // 12. SubjectDomains → Subjects
  await prisma.subjectDomain.deleteMany({
    where: { domain: { slug: { in: schoolSlugs } } },
  });
  await prisma.subject.deleteMany({
    where: { slug: { in: ["creative-comprehension", "spag"] } },
  });

  // 13. Domains (schools)
  await prisma.domain.deleteMany({
    where: { slug: { in: schoolSlugs } },
  });

  // 14. Parameters
  await prisma.parameter.deleteMany({
    where: { computedBy: "educator-demo" },
  });

  console.log("  Cleanup complete.");
}

// ══════════════════════════════════════════════════════════
// CREATION FUNCTIONS
// ══════════════════════════════════════════════════════════

async function createSubjects(): Promise<Map<string, string>> {
  console.log("  Creating subjects...");
  const subjectMap = new Map<string, string>(); // slug → id

  for (const s of SUBJECTS) {
    const subject = await prisma.subject.create({
      data: {
        slug: s.slug,
        name: s.name,
        description: s.description,
        qualificationBody: s.qualificationBody,
        qualificationLevel: s.qualificationLevel,
        defaultTrustLevel: "EXPERT_CURATED",
        isActive: true,
      },
    });
    subjectMap.set(s.slug, subject.id);
    console.log(`    Subject: ${s.name} (${subject.id})`);
  }

  return subjectMap;
}

async function createParameters(): Promise<void> {
  console.log("  Creating parameters...");
  const allParams = [...CC_PARAMETERS, ...SPAG_PARAMETERS];

  for (const p of allParams) {
    await prisma.parameter.create({
      data: {
        parameterId: p.parameterId,
        sectionId: p.sectionId,
        domainGroup: p.domainGroup,
        name: p.name,
        definition: p.definition,
        interpretationHigh: p.interpretationHigh,
        interpretationLow: p.interpretationLow,
        scaleType: "0-1",
        directionality: "positive",
        computedBy: "educator-demo",
        parameterType: "STATE",
        isAdjustable: false,
      },
    });
  }
  console.log(`    Created ${allParams.length} parameters`);
}

async function createSchools(
  subjectMap: Map<string, string>
): Promise<Map<string, string>> {
  console.log("  Creating schools...");
  const schoolMap = new Map<string, string>(); // slug → id

  for (const s of SCHOOLS) {
    const domain = await prisma.domain.create({
      data: {
        slug: s.slug,
        name: s.name,
        description: s.description,
        onboardingWelcome: s.onboardingWelcome,
        isActive: true,
      },
    });
    schoolMap.set(s.slug, domain.id);
    console.log(`    School: ${s.name} (${domain.id})`);

    // Link all subjects to this school
    for (const [, subjectId] of subjectMap) {
      await prisma.subjectDomain.create({
        data: { subjectId, domainId: domain.id },
      });
    }
  }

  return schoolMap;
}

async function createTeachers(
  schoolMap: Map<string, string>
): Promise<Map<string, { userId: string; callerId: string }>> {
  console.log("  Creating teachers...");
  const teacherMap = new Map<string, { userId: string; callerId: string }>();

  for (const t of TEACHERS) {
    const domainId = schoolMap.get(t.schoolSlug)!;
    const fullName = `${t.firstName} ${t.lastName}`;

    // Create User with hashed seed password
    if (process.env.NODE_ENV === "production" && !process.env.SEED_ADMIN_PASSWORD) {
      throw new Error(
        "SEED_ADMIN_PASSWORD must be set in production. Refusing to seed with default password."
      );
    }
    const seedPassword = process.env.SEED_ADMIN_PASSWORD || "admin123";
    const hashedPassword = await bcrypt.hash(seedPassword, 10);
    const user = await prisma.user.create({
      data: {
        email: t.email,
        name: fullName,
        displayName: fullName,
        role: t.userRole,
        passwordHash: hashedPassword,
        assignedDomainId: domainId,
        isActive: true,
      },
    });

    // Create Caller with TEACHER role
    const caller = await prisma.caller.create({
      data: {
        externalId: `edu-teacher-${t.email.split("@")[0]}`,
        name: fullName,
        email: t.email,
        role: "TEACHER",
        userId: user.id,
        domainId,
      },
    });

    teacherMap.set(t.email, { userId: user.id, callerId: caller.id });
    console.log(`    Teacher: ${fullName} (${t.email}) [${t.userRole}]`);
  }

  return teacherMap;
}

async function createClassrooms(
  schoolMap: Map<string, string>,
  teacherMap: Map<string, { userId: string; callerId: string }>
): Promise<Map<string, string>> {
  console.log("  Creating classrooms...");
  const classroomMap = new Map<string, string>(); // "schoolSlug/className" → id

  for (const c of CLASSROOMS) {
    const domainId = schoolMap.get(c.schoolSlug)!;

    // Find the teacher who owns this classroom
    const teacher = TEACHERS.find(
      (t) => t.schoolSlug === c.schoolSlug && t.className === c.name
    );
    if (!teacher) {
      console.error(`    No teacher found for ${c.schoolSlug}/${c.name}`);
      continue;
    }

    const teacherData = teacherMap.get(teacher.email)!;

    const cohort = await prisma.cohortGroup.create({
      data: {
        name: c.name,
        description: `Year 5 class ${c.name} at ${SCHOOLS.find((s) => s.slug === c.schoolSlug)!.name}`,
        domainId,
        ownerId: teacherData.callerId,
        maxMembers: 35,
        isActive: true,
      },
    });

    const key = `${c.schoolSlug}/${c.name}`;
    classroomMap.set(key, cohort.id);
    console.log(`    Classroom: ${c.name} → ${teacher.firstName} ${teacher.lastName}`);
  }

  return classroomMap;
}

interface PupilRecord {
  id: string;
  name: string;
  externalId: string;
  band: Band;
  schoolSlug: string;
  classKey: string;
  position: number;
}

async function createPupils(
  schoolMap: Map<string, string>,
  classroomMap: Map<string, string>
): Promise<PupilRecord[]> {
  console.log("  Creating pupils...");
  const pupils: PupilRecord[] = [];

  for (const c of CLASSROOMS) {
    const domainId = schoolMap.get(c.schoolSlug)!;
    const classKey = `${c.schoolSlug}/${c.name}`;
    const cohortGroupId = classroomMap.get(classKey)!;
    const pool = PUPIL_POOLS[c.poolIndex];

    for (let i = 0; i < pool.length; i++) {
      const name = pool[i];
      const position = i + 1; // 1-indexed
      const band = getBand(position);
      const externalId = `edu-demo-${c.schoolSlug}-${c.name.toLowerCase().replace(/\s+/g, "-")}-${(i + 1).toString().padStart(2, "0")}`;

      const caller = await prisma.caller.create({
        data: {
          externalId,
          name,
          role: "LEARNER",
          domainId,
          cohortGroupId,
        },
      });

      // Multi-cohort membership (new join table — kept in sync with legacy cohortGroupId)
      await prisma.callerCohortMembership.upsert({
        where: {
          callerId_cohortGroupId: {
            callerId: caller.id,
            cohortGroupId,
          },
        },
        update: {},
        create: {
          callerId: caller.id,
          cohortGroupId,
          role: "MEMBER",
        },
      });

      pupils.push({
        id: caller.id,
        name,
        externalId,
        band,
        schoolSlug: c.schoolSlug,
        classKey,
        position,
      });
    }

    console.log(`    ${c.name}: ${pool.length} pupils created`);
  }

  console.log(`    Total pupils: ${pupils.length}`);
  return pupils;
}

async function createCalls(
  pupils: PupilRecord[]
): Promise<Map<string, string[]>> {
  console.log("  Creating calls...");
  const pupilCallIds = new Map<string, string[]>(); // callerId → callIds

  let totalCalls = 0;

  for (const pupil of pupils) {
    const [minCalls, maxCalls] = bandCallCount(pupil.band);
    const numCalls = seededInt(minCalls, maxCalls, `calls-${pupil.externalId}`);

    if (numCalls === 0) {
      pupilCallIds.set(pupil.id, []);
      continue;
    }

    const callIds: string[] = [];
    const templates = TRANSCRIPT_TEMPLATES;

    for (let c = 0; c < numCalls; c++) {
      // Alternate CC and SPAG templates
      const templateIndex = c % templates.length;
      const template = templates[templateIndex];

      // Pick transcript variant based on band
      const firstName = pupil.name.split(" ")[0];
      const transcript = template.variants[pupil.band].replace(
        /\{\{name\}\}/g,
        firstName
      );

      // Stagger call dates over the last 60 days
      const daysAgo = Math.floor(60 - (c / numCalls) * 55);
      const callDate = new Date();
      callDate.setDate(callDate.getDate() - daysAgo);
      callDate.setHours(9 + seededInt(0, 5, `hour-${pupil.externalId}-${c}`));
      callDate.setMinutes(seededInt(0, 59, `min-${pupil.externalId}-${c}`));

      const endDate = new Date(callDate);
      endDate.setMinutes(endDate.getMinutes() + seededInt(8, 25, `dur-${pupil.externalId}-${c}`));

      const call = await prisma.call.create({
        data: {
          source: "educator-demo",
          externalId: `edu-demo-call-${pupil.externalId}-${c + 1}`,
          callerId: pupil.id,
          transcript,
          callSequence: c + 1,
          createdAt: callDate,
          endedAt: endDate,
        },
      });

      callIds.push(call.id);
      totalCalls++;
    }

    pupilCallIds.set(pupil.id, callIds);
  }

  console.log(`    Total calls: ${totalCalls}`);
  return pupilCallIds;
}

async function createCallScores(
  pupils: PupilRecord[],
  pupilCallIds: Map<string, string[]>
): Promise<number> {
  console.log("  Creating call scores...");
  let totalScores = 0;
  const scoreBatch: Array<{
    callId: string;
    callerId: string;
    parameterId: string;
    score: number;
    confidence: number;
    evidence: string[];
    reasoning: string;
    scoredBy: string;
  }> = [];

  const templates = TRANSCRIPT_TEMPLATES;

  for (const pupil of pupils) {
    const callIds = pupilCallIds.get(pupil.id) || [];
    if (callIds.length === 0) continue;

    const [minScore, maxScore] = bandScoreRange(pupil.band);

    for (let c = 0; c < callIds.length; c++) {
      const templateIndex = c % templates.length;
      const template = templates[templateIndex];

      for (const paramId of template.parameters) {
        const score = r2(
          seededRange(minScore, maxScore, `score-${pupil.externalId}-${c}-${paramId}`)
        );
        const confidence = r2(
          seededRange(0.6, 0.9, `conf-${pupil.externalId}-${c}-${paramId}`)
        );

        scoreBatch.push({
          callId: callIds[c],
          callerId: pupil.id,
          parameterId: paramId,
          score,
          confidence,
          evidence: [`Extracted from ${template.title}`],
          reasoning: `${pupil.band} band performance on ${paramId}`,
          scoredBy: "educator-demo",
        });
        totalScores++;
      }
    }
  }

  // Batch insert in chunks of 500
  for (let i = 0; i < scoreBatch.length; i += 500) {
    const chunk = scoreBatch.slice(i, i + 500);
    await prisma.callScore.createMany({ data: chunk });
  }

  console.log(`    Total scores: ${totalScores}`);
  return totalScores;
}

async function createMemories(
  pupils: PupilRecord[],
  pupilCallIds: Map<string, string[]>
): Promise<number> {
  console.log("  Creating memories...");
  let totalMemories = 0;

  const memoryBatch: Array<{
    callerId: string;
    category: "FACT" | "PREFERENCE" | "TOPIC" | "CONTEXT";
    source: "EXTRACTED";
    key: string;
    value: string;
    confidence: number;
    extractedBy: string;
  }> = [];

  const summaryBatch: Array<{
    callerId: string;
    factCount: number;
    preferenceCount: number;
    topicCount: number;
    eventCount: number;
  }> = [];

  for (const pupil of pupils) {
    const callIds = pupilCallIds.get(pupil.id) || [];
    if (callIds.length < 2) continue;

    const firstName = pupil.name.split(" ")[0];
    const ccFocus = seededRandom(`cc-focus-${pupil.externalId}`) > 0.5
      ? "inference skills"
      : "cross-source analysis";
    const spagFocus = seededRandom(`spag-focus-${pupil.externalId}`) > 0.5
      ? "punctuation and commas"
      : "spelling patterns";

    const memories = [
      // FACT
      { category: "FACT" as const, key: "first_name", value: firstName, confidence: 0.98 },
      { category: "FACT" as const, key: "year_group", value: "Year 5", confidence: 0.95 },
      { category: "FACT" as const, key: "age", value: "9-10 years old", confidence: 0.90 },
      { category: "FACT" as const, key: "key_stage", value: "Key Stage 2", confidence: 0.95 },
      // PREFERENCE
      {
        category: "PREFERENCE" as const,
        key: "learning_style",
        value: pupil.band === "high"
          ? "Enjoys independent challenges and deeper analysis"
          : pupil.band === "onTrack"
            ? "Responds well to guided practice with examples"
            : "Needs scaffolding and step-by-step support",
        confidence: 0.80,
      },
      {
        category: "PREFERENCE" as const,
        key: "difficulty_preference",
        value: pupil.band === "high"
          ? "Prefers challenging extension material"
          : pupil.band === "support"
            ? "Prefers simple, concrete tasks"
            : "Comfortable with age-appropriate difficulty",
        confidence: 0.75,
      },
      // TOPIC
      {
        category: "TOPIC" as const,
        key: "current_focus",
        value: `Developing ${ccFocus} in Creative Comprehension`,
        confidence: 0.85,
      },
      {
        category: "TOPIC" as const,
        key: "spag_focus",
        value: `Practising ${spagFocus}`,
        confidence: 0.85,
      },
    ];

    for (const m of memories) {
      memoryBatch.push({
        callerId: pupil.id,
        category: m.category,
        source: "EXTRACTED",
        key: m.key,
        value: m.value,
        confidence: m.confidence,
        extractedBy: "educator-demo",
      });
      totalMemories++;
    }

    summaryBatch.push({
      callerId: pupil.id,
      factCount: 4,
      preferenceCount: 2,
      topicCount: 2,
      eventCount: 0,
    });
  }

  // Batch insert
  for (let i = 0; i < memoryBatch.length; i += 500) {
    const chunk = memoryBatch.slice(i, i + 500);
    await prisma.callerMemory.createMany({ data: chunk });
  }

  for (const s of summaryBatch) {
    await prisma.callerMemorySummary.create({ data: s });
  }

  console.log(`    Total memories: ${totalMemories}`);
  console.log(`    Memory summaries: ${summaryBatch.length}`);
  return totalMemories;
}

async function createPersonalityProfiles(
  pupils: PupilRecord[],
  pupilCallIds: Map<string, string[]>
): Promise<number> {
  console.log("  Creating personality profiles...");
  let count = 0;

  for (const pupil of pupils) {
    const callIds = pupilCallIds.get(pupil.id) || [];
    if (callIds.length < 3) continue;

    // Generate VARK learning style based on band
    const parameterValues: Record<string, number> = {
      "VARK-VISUAL": r2(seededRange(0.3, 0.9, `vark-v-${pupil.externalId}`)),
      "VARK-AUDITORY": r2(seededRange(0.3, 0.9, `vark-a-${pupil.externalId}`)),
      "VARK-READWRITE": r2(seededRange(0.3, 0.9, `vark-r-${pupil.externalId}`)),
      "VARK-KINESTHETIC": r2(seededRange(0.3, 0.9, `vark-k-${pupil.externalId}`)),
    };

    // Add Big Five traits with band-influenced distribution
    const bandBoost = pupil.band === "high" ? 0.15 : pupil.band === "onTrack" ? 0.05 : -0.05;
    parameterValues["B5-O"] = r2(Math.min(1, Math.max(0, seededRange(0.3, 0.8, `b5o-${pupil.externalId}`) + bandBoost)));
    parameterValues["B5-C"] = r2(Math.min(1, Math.max(0, seededRange(0.3, 0.8, `b5c-${pupil.externalId}`) + bandBoost)));
    parameterValues["B5-E"] = r2(seededRange(0.2, 0.9, `b5e-${pupil.externalId}`));
    parameterValues["B5-A"] = r2(seededRange(0.4, 0.9, `b5a-${pupil.externalId}`));
    parameterValues["B5-N"] = r2(seededRange(0.1, 0.6, `b5n-${pupil.externalId}`));

    await prisma.callerPersonalityProfile.create({
      data: {
        callerId: pupil.id,
        parameterValues,
        callsUsed: callIds.length,
        specsUsed: 2,
        lastUpdatedAt: new Date(),
      },
    });
    count++;
  }

  console.log(`    Personality profiles: ${count}`);
  return count;
}

async function createGoals(
  pupils: PupilRecord[]
): Promise<number> {
  console.log("  Creating goals...");
  let count = 0;

  const goalBatch: Array<{
    callerId: string;
    type: "LEARN";
    name: string;
    description: string;
    status: "ACTIVE" | "COMPLETED";
    progress: number;
    priority: number;
    startedAt: Date;
    targetDate: Date;
  }> = [];

  for (const pupil of pupils) {
    const [minProgress, maxProgress] = bandGoalProgress(pupil.band);

    const ccProgress = r2(seededRange(minProgress, maxProgress, `goal-cc-${pupil.externalId}`));
    const spagProgress = r2(seededRange(minProgress, maxProgress, `goal-spag-${pupil.externalId}`));

    const startedAt = new Date();
    startedAt.setDate(startedAt.getDate() - 60);

    const targetDate = new Date();
    targetDate.setMonth(targetDate.getMonth() + 6);

    goalBatch.push({
      callerId: pupil.id,
      type: "LEARN",
      name: "Creative Comprehension Mastery",
      description:
        "Develop inference, cross-source analysis, literary devices, PEA technique, and vocabulary skills for 11+ exam preparation.",
      status: ccProgress >= 0.85 ? "COMPLETED" : "ACTIVE",
      progress: ccProgress,
      priority: 1,
      startedAt,
      targetDate,
    });

    goalBatch.push({
      callerId: pupil.id,
      type: "LEARN",
      name: "SPAG Mastery",
      description:
        "Master Year 5 spelling, punctuation, grammar, and sentence structure for Key Stage 2 assessments.",
      status: spagProgress >= 0.85 ? "COMPLETED" : "ACTIVE",
      progress: spagProgress,
      priority: 2,
      startedAt,
      targetDate,
    });

    count += 2;
  }

  // Batch insert
  for (let i = 0; i < goalBatch.length; i += 500) {
    const chunk = goalBatch.slice(i, i + 500);
    await prisma.goal.createMany({ data: chunk });
  }

  console.log(`    Goals: ${count}`);
  return count;
}

// ══════════════════════════════════════════════════════════
// PLAYBOOKS & CONTENT
// ══════════════════════════════════════════════════════════

async function createPlaybooks(
  schoolMap: Map<string, string>
): Promise<Map<string, string>> {
  console.log("  Creating playbooks...");
  const playbookMap = new Map<string, string>(); // schoolSlug → playbookId

  // Find system specs to enable in playbook config
  const systemSpecs = await prisma.analysisSpec.findMany({
    where: { specType: "SYSTEM", isActive: true },
    select: { id: true },
  });

  const systemSpecToggles: Record<string, { isEnabled: boolean }> = {};
  for (const ss of systemSpecs) {
    systemSpecToggles[ss.id] = { isEnabled: true };
  }

  // Find the TUT-001 identity spec (base archetype for schools)
  const identitySpec = await prisma.analysisSpec.findFirst({
    where: { slug: { contains: "tut-001", mode: "insensitive" }, isActive: true },
    select: { id: true, name: true },
  });

  for (const school of SCHOOLS) {
    const domainId = schoolMap.get(school.slug)!;

    const playbook = await prisma.playbook.create({
      data: {
        name: `${school.name} Programme`,
        description: `Learning programme for ${school.name} — Creative Comprehension and SPAG`,
        domainId,
        status: "PUBLISHED",
        version: "1.0",
        publishedAt: new Date(),
        publishedBy: "educator-demo",
        config: { systemSpecToggles },
        measureSpecCount: 2,
        learnSpecCount: 1,
        adaptSpecCount: 1,
        parameterCount: 12,
      },
    });

    playbookMap.set(school.slug, playbook.id);

    // Add identity spec to playbook
    if (identitySpec) {
      await prisma.playbookItem.create({
        data: {
          playbookId: playbook.id,
          itemType: "SPEC",
          specId: identitySpec.id,
          isEnabled: true,
          sortOrder: 0,
        },
      });
    }

    console.log(`    Playbook: ${school.name} Programme (${playbook.id})`);
  }

  console.log(`    System specs toggled: ${systemSpecs.length}`);
  return playbookMap;
}

// ── Content assertion definitions for CC ──
const CC_ASSERTIONS = [
  // Inference
  { assertion: "Pupils should identify implied meanings from textual clues without explicit statement", category: "rule", tags: ["inference", "comprehension"], param: "CC-INFERENCE" },
  { assertion: "Readers should deduce character feelings and motivations from actions and dialogue", category: "rule", tags: ["inference", "character"], param: "CC-INFERENCE" },
  { assertion: "Inference requires combining background knowledge with textual evidence to reach conclusions", category: "definition", tags: ["inference"], param: "CC-INFERENCE" },
  // Retrieval
  { assertion: "Pupils should locate specific information from text, maps, charts, and images accurately", category: "rule", tags: ["retrieval", "comprehension"], param: "CC-RETRIEVAL" },
  { assertion: "Scanning and skimming techniques support efficient information retrieval from multiple source types", category: "rule", tags: ["retrieval", "technique"], param: "CC-RETRIEVAL" },
  { assertion: "Retrieval questions require direct evidence from the text, not personal opinion", category: "definition", tags: ["retrieval"], param: "CC-RETRIEVAL" },
  // Cross-Source
  { assertion: "Pupils should compare and contrast information presented across at least two different source types", category: "rule", tags: ["cross-source", "analysis"], param: "CC-CROSS-SRC" },
  { assertion: "Cross-referencing text with visual sources (maps, diagrams, images) strengthens analytical responses", category: "rule", tags: ["cross-source", "visual"], param: "CC-CROSS-SRC" },
  { assertion: "Pupils should identify where sources agree, contradict, or complement one another", category: "rule", tags: ["cross-source", "evaluation"], param: "CC-CROSS-SRC" },
  // Literary Devices
  { assertion: "Pupils should identify metaphor, simile, personification, alliteration, and onomatopoeia in texts", category: "rule", tags: ["literary-devices", "identification"], param: "CC-LITERARY" },
  { assertion: "Identifying a literary device is insufficient — pupils must explain the effect on the reader", category: "rule", tags: ["literary-devices", "effect"], param: "CC-LITERARY" },
  { assertion: "A simile compares two things using 'like' or 'as'; a metaphor states one thing is another", category: "definition", tags: ["literary-devices", "simile", "metaphor"], param: "CC-LITERARY" },
  // Vocabulary
  { assertion: "Pupils should define unfamiliar words using surrounding context, morphology, and semantic clues", category: "rule", tags: ["vocabulary", "context"], param: "CC-VOCAB" },
  { assertion: "Word roots, prefixes, and suffixes provide reliable clues for deducing unfamiliar vocabulary", category: "rule", tags: ["vocabulary", "morphology"], param: "CC-VOCAB" },
  { assertion: "Contextual vocabulary questions assess whether pupils can work out meanings without a dictionary", category: "definition", tags: ["vocabulary"], param: "CC-VOCAB" },
  // PEA
  { assertion: "Written responses should follow Point-Evidence-Analysis structure for full marks", category: "rule", tags: ["PEA", "structure"], param: "CC-PEA" },
  { assertion: "Evidence must be a direct quotation or close paraphrase from the text, not a general reference", category: "rule", tags: ["PEA", "evidence"], param: "CC-PEA" },
  { assertion: "Analysis should explain why the evidence supports the point, not merely restate it", category: "rule", tags: ["PEA", "analysis"], param: "CC-PEA" },
  // Summarising
  { assertion: "Pupils should capture main ideas concisely in their own words, omitting minor details", category: "rule", tags: ["summarising"], param: "CC-SUMMARY" },
  { assertion: "A good summary distinguishes key points from supporting or illustrative detail", category: "rule", tags: ["summarising", "key-points"], param: "CC-SUMMARY" },
  { assertion: "Summaries should not copy sentences verbatim — paraphrasing demonstrates comprehension", category: "rule", tags: ["summarising", "paraphrase"], param: "CC-SUMMARY" },
  // Opinion
  { assertion: "Pupils should form personal opinions about texts and justify them with specific textual evidence", category: "rule", tags: ["opinion", "justification"], param: "CC-OPINION" },
  { assertion: "An opinion response must distinguish between personal reaction and factual statement", category: "rule", tags: ["opinion", "fact-vs-opinion"], param: "CC-OPINION" },
  { assertion: "Higher-level responses consider alternative viewpoints before reaching a personal conclusion", category: "rule", tags: ["opinion", "evaluation"], param: "CC-OPINION" },
];

// ── Content assertion definitions for SPAG ──
const SPAG_ASSERTIONS = [
  // Spelling
  { assertion: "Pupils should spell all Year 5/6 statutory words correctly, including exception words", category: "rule", tags: ["spelling", "statutory"], param: "SPAG-SPELL" },
  { assertion: "Common spelling patterns include: -ough, -tion/-sion, -ible/-able, -cious/-tious", category: "fact", tags: ["spelling", "patterns"], param: "SPAG-SPELL" },
  { assertion: "Prefixes (un-, dis-, mis-, re-, pre-) do not change the spelling of the root word", category: "rule", tags: ["spelling", "prefix"], param: "SPAG-SPELL" },
  { assertion: "When adding suffixes beginning with a vowel to words ending in -e, the -e is usually dropped", category: "rule", tags: ["spelling", "suffix"], param: "SPAG-SPELL" },
  // Punctuation
  { assertion: "Commas should separate items in a list, after fronted adverbials, and around embedded clauses", category: "rule", tags: ["punctuation", "commas"], param: "SPAG-PUNCT" },
  { assertion: "Apostrophes mark omission (don't, it's) and possession (the dog's bone, the children's toys)", category: "rule", tags: ["punctuation", "apostrophe"], param: "SPAG-PUNCT" },
  { assertion: "Speech marks enclose the exact words spoken; a comma or question mark precedes the closing mark", category: "rule", tags: ["punctuation", "speech"], param: "SPAG-PUNCT" },
  { assertion: "Semicolons join two closely related independent clauses without a conjunction", category: "rule", tags: ["punctuation", "semicolon"], param: "SPAG-PUNCT" },
  // Grammar
  { assertion: "Subject and verb must agree in number: 'the children were' not 'the children was'", category: "rule", tags: ["grammar", "agreement"], param: "SPAG-GRAM" },
  { assertion: "Active voice: the subject performs the action. Passive voice: the subject receives the action", category: "definition", tags: ["grammar", "voice"], param: "SPAG-GRAM" },
  { assertion: "Modal verbs (can, could, may, might, should, would, must) express possibility, permission, or obligation", category: "definition", tags: ["grammar", "modal"], param: "SPAG-GRAM" },
  // Sentence Structure
  { assertion: "A simple sentence has one main clause with a subject and verb: 'The cat sat.'", category: "definition", tags: ["sentence", "simple"], param: "SPAG-SENT" },
  { assertion: "A compound sentence joins two main clauses with a coordinating conjunction (and, but, or, so)", category: "definition", tags: ["sentence", "compound"], param: "SPAG-SENT" },
  { assertion: "A complex sentence uses a subordinate clause (because, although, when, if) with a main clause", category: "definition", tags: ["sentence", "complex"], param: "SPAG-SENT" },
  { assertion: "Fronted adverbials (e.g. 'Cautiously, the fox...') add variety to sentence openers", category: "rule", tags: ["sentence", "fronted-adverbial"], param: "SPAG-SENT" },
];

async function createContentSources(
  schoolMap: Map<string, string>,
  subjectMap: Map<string, string>
): Promise<Map<string, string>> {
  console.log("  Creating content sources...");
  const sourceMap = new Map<string, string>(); // "schoolSlug/subjectSlug" → sourceId

  const ccSubjectId = subjectMap.get("creative-comprehension")!;
  const spagSubjectId = subjectMap.get("spag")!;

  for (const school of SCHOOLS) {
    // CC syllabus
    const ccSource = await prisma.contentSource.create({
      data: {
        slug: `edu-demo-cc-syllabus-${school.slug}`,
        name: "11+ Creative Comprehension Syllabus",
        description: "GL Assessment and CEM-aligned comprehension curriculum covering inference, retrieval, cross-source analysis, literary devices, vocabulary, PEA technique, summarising, and opinion forming.",
        trustLevel: "EXPERT_CURATED",
        documentType: "CURRICULUM",
        documentTypeSource: "educator-demo",
        publisherOrg: "GL Assessment / CEM",
        qualificationRef: "11+ Creative Comprehension",
        moduleCoverage: CC_PARAMETERS.map((p) => p.parameterId),
        isActive: true,
      },
    });
    sourceMap.set(`${school.slug}/creative-comprehension`, ccSource.id);

    // Link CC source to CC subject
    await prisma.subjectSource.create({
      data: { subjectId: ccSubjectId, sourceId: ccSource.id },
    });

    // SPAG syllabus
    const spagSource = await prisma.contentSource.create({
      data: {
        slug: `edu-demo-spag-syllabus-${school.slug}`,
        name: "KS2 SPAG Curriculum Guide",
        description: "National Curriculum-aligned spelling, punctuation, grammar, and sentence structure guide for Key Stage 2 assessments.",
        trustLevel: "EXPERT_CURATED",
        documentType: "CURRICULUM",
        documentTypeSource: "educator-demo",
        publisherOrg: "Department for Education",
        qualificationRef: "KS2 SPAG",
        moduleCoverage: SPAG_PARAMETERS.map((p) => p.parameterId),
        isActive: true,
      },
    });
    sourceMap.set(`${school.slug}/spag`, spagSource.id);

    // Link SPAG source to SPAG subject
    await prisma.subjectSource.create({
      data: { subjectId: spagSubjectId, sourceId: spagSource.id },
    });

    console.log(`    ${school.name}: CC syllabus + SPAG guide`);
  }

  return sourceMap;
}

async function createContentAssertions(
  sourceMap: Map<string, string>
): Promise<number> {
  console.log("  Creating content assertions...");
  let totalAssertions = 0;

  const categoryToTeachMethod = (cat: string): string => {
    if (cat === "definition") return "definition_matching";
    if (cat === "example" || cat === "process") return "worked_example";
    return "recall_quiz"; // fact, rule, threshold, concept
  };

  const assertionBatch: Array<{
    sourceId: string;
    assertion: string;
    category: string;
    tags: string[];
    teachMethod: string;
    createdBy: string;
  }> = [];

  for (const school of SCHOOLS) {
    const ccSourceId = sourceMap.get(`${school.slug}/creative-comprehension`);
    const spagSourceId = sourceMap.get(`${school.slug}/spag`);

    if (ccSourceId) {
      for (const a of CC_ASSERTIONS) {
        assertionBatch.push({
          sourceId: ccSourceId,
          assertion: a.assertion,
          category: a.category,
          tags: [...a.tags, a.param],
          teachMethod: categoryToTeachMethod(a.category),
          createdBy: "educator-demo",
        });
        totalAssertions++;
      }
    }

    if (spagSourceId) {
      for (const a of SPAG_ASSERTIONS) {
        assertionBatch.push({
          sourceId: spagSourceId,
          assertion: a.assertion,
          category: a.category,
          tags: [...a.tags, a.param],
          teachMethod: categoryToTeachMethod(a.category),
          createdBy: "educator-demo",
        });
        totalAssertions++;
      }
    }
  }

  // Batch insert
  for (let i = 0; i < assertionBatch.length; i += 500) {
    const chunk = assertionBatch.slice(i, i + 500);
    await prisma.contentAssertion.createMany({ data: chunk });
  }

  console.log(`    Total assertions: ${totalAssertions}`);
  return totalAssertions;
}

// ══════════════════════════════════════════════════════════
// ONBOARDING (identity spec + flow phases + CC worksheet)
// ══════════════════════════════════════════════════════════

/**
 * CC Practice Worksheet — delivered to pupils at the start of their first session.
 * The AI tutor shares this during the "first-topic" onboarding phase so the pupil
 * has a comprehension passage + questions to work through together.
 */
const CC_WORKSHEET_CONTENT = `
═══════════════════════════════════════════════════════════════
  CREATIVE COMPREHENSION — PRACTICE WORKSHEET
  11+ Preparation: Inference, Retrieval & Analysis
═══════════════════════════════════════════════════════════════

PASSAGE A — "The Secret Garden" (adapted from Frances Hodgson Burnett)

  When Mary first stepped through the hidden door, she could hardly
  believe her eyes. The garden had been locked for ten years, and
  nature had woven a wild tapestry across every wall and pathway.
  Climbing roses had scrambled over the grey stones like green
  curtains, and beneath them, tiny green points were pushing through
  the dark earth — determined little shoots that refused to give up.

  "It isn't quite dead," Mary whispered, dropping to her knees.
  Her heart hammered with a feeling she had never known before —
  something between excitement and fierce protectiveness, as though
  the garden had chosen her to bring it back to life.


PASSAGE B — Garden Restoration Data (non-fiction)

  | Year | Plants Identified | Species Recovered | Visitor Interest |
  |------|------------------|-------------------|-----------------|
  | 1911 |        12        |         3         |      Low        |
  | 1912 |        34        |        12         |    Growing      |
  | 1913 |        67        |        28         |      High       |

  The Royal Horticultural Society notes that abandoned gardens can
  recover within 2-3 growing seasons if root systems remain intact.
  "Roses are particularly resilient," explains Dr Sarah Chen.
  "Their root networks can survive decades of neglect."


QUESTIONS

  1. RETRIEVAL: According to Passage A, how long had the garden
     been locked? Find the exact detail in the text.  [1 mark]

  2. INFERENCE: What does the phrase "fierce protectiveness" tell
     us about how Mary feels towards the garden? What can we
     infer about her character from this reaction?   [2 marks]

  3. LITERARY DEVICES: Identify the simile in the first paragraph
     and explain its effect on the reader.           [2 marks]

  4. VOCABULARY: What does "tapestry" mean in context? How do the
     surrounding words help you work out the meaning? [2 marks]

  5. CROSS-SOURCE: Using both passages, explain why there is hope
     for the garden's recovery. Use evidence from both the fiction
     and non-fiction texts.                           [3 marks]

  6. PEA PRACTICE: Write a Point-Evidence-Analysis paragraph
     answering: "How does the author make the reader feel
     hopeful about the garden?"                      [3 marks]

  7. OPINION: Do you think Mary is the right person to look after
     the garden? Give your opinion with evidence.    [2 marks]

═══════════════════════════════════════════════════════════════
  Total: 15 marks  |  Time guide: work through with your AI tutor
═══════════════════════════════════════════════════════════════
`.trim();

async function createOnboarding(
  schoolMap: Map<string, string>,
  subjectMap: Map<string, string>,
  teacherMap: Map<string, { userId: string; callerId: string }>
): Promise<void> {
  console.log("  Configuring onboarding...");

  // Find the TUT-001 identity spec for onboarding
  const identitySpec = await prisma.analysisSpec.findFirst({
    where: { slug: { contains: "tut-001", mode: "insensitive" }, isActive: true },
    select: { id: true },
  });

  const ccSubjectId = subjectMap.get("creative-comprehension")!;

  for (const school of SCHOOLS) {
    const domainId = schoolMap.get(school.slug)!;

    // Find an admin teacher for this school (needed as MediaAsset uploader)
    const adminTeacher = TEACHERS.find((t) => t.schoolSlug === school.slug && t.userRole === "ADMIN");
    const adminData = adminTeacher ? teacherMap.get(adminTeacher.email) : null;

    // Create CC worksheet MediaAsset for this school
    let worksheetId: string | undefined;
    if (adminData) {
      const worksheet = await prisma.mediaAsset.create({
        data: {
          fileName: "cc-practice-worksheet.txt",
          fileSize: CC_WORKSHEET_CONTENT.length,
          mimeType: "text/plain",
          contentHash: `edu-demo-cc-worksheet-${school.slug}`, // Unique per school
          storageKey: `edu-demo/worksheets/${school.slug}/cc-practice-worksheet.txt`,
          storageType: "seed", // Indicates this is seed data, not a real upload
          title: "Creative Comprehension Practice Worksheet",
          description: "11+ preparation worksheet covering inference, retrieval, cross-source analysis, literary devices, vocabulary, PEA technique, and opinion — based on The Secret Garden.",
          tags: ["worksheet", "comprehension", "11+", "inference", "retrieval", "PEA"],
          uploadedBy: adminData.userId,
          trustLevel: "EXPERT_CURATED",
        },
      });
      worksheetId = worksheet.id;

      // Link worksheet to CC subject
      await prisma.subjectMedia.create({
        data: { subjectId: ccSubjectId, mediaId: worksheet.id },
      });
    }

    // Build onboarding flow phases — tailored for 11+ Creative Comprehension
    const flowPhases = {
      phases: [
        {
          phase: "welcome",
          duration: "2-3 minutes",
          goals: [
            `Welcome the pupil to ${school.name}'s AI tutoring programme`,
            "Introduce yourself as their personal AI tutor",
            "Make them feel comfortable and safe — this isn't a test",
            "Explain that you'll be practising comprehension skills together",
          ],
        },
        {
          phase: "discovery",
          duration: "3-5 minutes",
          goals: [
            "Ask what they enjoy reading (fiction, non-fiction, comics, etc.)",
            "Find out how they feel about comprehension exercises",
            "Discover which areas they find tricky (inference, vocabulary, PEA, etc.)",
            "Learn about their 11+ preparation goals and timeline",
          ],
        },
        {
          phase: "first-topic",
          duration: "8-12 minutes",
          goals: [
            "Share the practice worksheet and work through it together",
            "Start with the retrieval question (Question 1) to build confidence",
            "Move to inference (Question 2) — model how to 'read between the lines'",
            "Attempt at least one PEA paragraph together (Question 6)",
            "Praise effort and explain how each skill connects to the 11+ exam",
          ],
          ...(worksheetId ? {
            content: [
              {
                mediaId: worksheetId,
                instruction: "Share this worksheet at the start of the phase. Say something like: 'I've got a practice passage for us to work through together — take a look!'",
              },
            ],
          } : {}),
        },
        {
          phase: "wrap-up",
          duration: "2-3 minutes",
          goals: [
            "Summarise what skills they practised today",
            "Highlight one specific thing they did well",
            "Preview what they'll work on next session",
            "End on an encouraging note about their 11+ preparation",
          ],
        },
      ],
    };

    // Update domain with onboarding config
    await prisma.domain.update({
      where: { id: domainId },
      data: {
        onboardingIdentitySpecId: identitySpec?.id || null,
        onboardingFlowPhases: flowPhases,
      },
    });

    console.log(`    ${school.name}: onboarding configured${worksheetId ? " + CC worksheet" : ""}`);
  }
}

// ══════════════════════════════════════════════════════════
// ENROLLMENTS (CallerPlaybook + CohortPlaybook)
// ══════════════════════════════════════════════════════════

async function createEnrollments(
  pupils: PupilRecord[],
  playbookMap: Map<string, string>,
  classroomMap: Map<string, string>
): Promise<{ callerEnrollments: number; cohortEnrollments: number }> {
  console.log("  Creating enrollments...");

  // 1. CohortPlaybook — link each classroom to its school's playbook
  let cohortEnrollments = 0;
  for (const c of CLASSROOMS) {
    const classKey = `${c.schoolSlug}/${c.name}`;
    const cohortGroupId = classroomMap.get(classKey);
    const playbookId = playbookMap.get(c.schoolSlug);

    if (cohortGroupId && playbookId) {
      await prisma.cohortPlaybook.create({
        data: {
          cohortGroupId,
          playbookId,
          assignedBy: "educator-demo",
        },
      });
      cohortEnrollments++;
    }
  }

  // 2. CallerPlaybook — enroll each pupil in their school's playbook
  const enrollmentBatch: Array<{
    callerId: string;
    playbookId: string;
    status: "ACTIVE";
    enrolledBy: string;
  }> = [];

  for (const pupil of pupils) {
    const playbookId = playbookMap.get(pupil.schoolSlug);
    if (playbookId) {
      enrollmentBatch.push({
        callerId: pupil.id,
        playbookId,
        status: "ACTIVE",
        enrolledBy: "educator-demo",
      });
    }
  }

  // Batch insert
  for (let i = 0; i < enrollmentBatch.length; i += 500) {
    const chunk = enrollmentBatch.slice(i, i + 500);
    await prisma.callerPlaybook.createMany({ data: chunk });
  }

  console.log(`    Cohort enrollments: ${cohortEnrollments}`);
  console.log(`    Pupil enrollments: ${enrollmentBatch.length}`);
  return { callerEnrollments: enrollmentBatch.length, cohortEnrollments };
}

// ══════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════

export async function main(externalPrisma?: PrismaClient) {
  prisma = externalPrisma || new PrismaClient();
  console.log("\n══════════════════════════════════════════════");
  console.log("  EDUCATOR DEMO SEED");
  console.log("══════════════════════════════════════════════\n");

  const t0 = Date.now();

  await cleanupExistingData();

  // Ensure Boaz superadmin exists
  const boazPassword = process.env.SEED_ADMIN_PASSWORD || "admin123";
  const boazHash = await bcrypt.hash(boazPassword, 10);
  await prisma.user.upsert({
    where: { email: "boaz@tal.biz" },
    update: { passwordHash: boazHash, role: "SUPERADMIN", isActive: true },
    create: {
      email: "boaz@tal.biz",
      name: "Boaz Tal",
      role: "SUPERADMIN",
      isActive: true,
      passwordHash: boazHash,
    },
  });
  console.log("   ✓ Admin user ready: boaz@tal.biz (SUPERADMIN)");

  // Ensure Eldar superadmin exists
  await prisma.user.upsert({
    where: { email: "eldar.gilad@gmail.com" },
    update: { passwordHash: boazHash, role: "SUPERADMIN", isActive: true },
    create: {
      email: "eldar.gilad@gmail.com",
      name: "Eldar Gilad",
      role: "SUPERADMIN",
      isActive: true,
      passwordHash: boazHash,
    },
  });
  console.log("   ✓ Admin user ready: eldar.gilad@gmail.com (SUPERADMIN)");

  const subjectMap = await createSubjects();
  await createParameters();
  const schoolMap = await createSchools(subjectMap);
  const teacherMap = await createTeachers(schoolMap);
  const classroomMap = await createClassrooms(schoolMap, teacherMap);
  const pupils = await createPupils(schoolMap, classroomMap);
  const pupilCallIds = await createCalls(pupils);
  const totalScores = await createCallScores(pupils, pupilCallIds);
  const totalMemories = await createMemories(pupils, pupilCallIds);
  const totalProfiles = await createPersonalityProfiles(pupils, pupilCallIds);
  const totalGoals = await createGoals(pupils);

  // Playbooks, content, onboarding, enrollments (makes schools "Ready for learners")
  const playbookMap = await createPlaybooks(schoolMap);
  const sourceMap = await createContentSources(schoolMap, subjectMap);
  const totalAssertions = await createContentAssertions(sourceMap);
  await createOnboarding(schoolMap, subjectMap, teacherMap);
  const { callerEnrollments, cohortEnrollments } = await createEnrollments(pupils, playbookMap, classroomMap);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log("\n══════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("══════════════════════════════════════════════");
  console.log(`  Schools:      ${SCHOOLS.length}`);
  console.log(`  Subjects:     ${SUBJECTS.length}`);
  console.log(`  Parameters:   ${CC_PARAMETERS.length + SPAG_PARAMETERS.length}`);
  console.log(`  Teachers:     ${TEACHERS.length}`);
  console.log(`  Classrooms:   ${CLASSROOMS.length}`);
  console.log(`  Pupils:       ${pupils.length}`);
  console.log(`  Calls:        ${[...pupilCallIds.values()].reduce((s, v) => s + v.length, 0)}`);
  console.log(`  Scores:       ${totalScores}`);
  console.log(`  Memories:     ${totalMemories}`);
  console.log(`  Profiles:     ${totalProfiles}`);
  console.log(`  Goals:        ${totalGoals}`);
  console.log(`  Playbooks:    ${playbookMap.size}`);
  console.log(`  Sources:      ${sourceMap.size}`);
  console.log(`  Assertions:   ${totalAssertions}`);
  console.log(`  Enrollments:  ${callerEnrollments} pupils + ${cohortEnrollments} cohorts`);
  console.log(`  Onboarding:   ${SCHOOLS.length} schools (with CC worksheet)`);
  console.log(`  Time:         ${elapsed}s`);
  console.log("══════════════════════════════════════════════");
  console.log(`\n  Login as: j.chen@oakwood.sch.uk / (SEED_ADMIN_PASSWORD)\n`);
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error("\nSeed failed:", e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
