/**
 * Companion - Conversational/Educational Assistant for Curious Older Adults
 *
 * Run with: npx tsx prisma/seed-companion.ts
 *
 * Creates a companion assistant optimized for:
 * - Intelligent, curious older adults
 * - Conversational depth over brevity
 * - Respect for life experience and wisdom
 * - Patience and unhurried pacing
 * - Intellectual stimulation without condescension
 * - Memory of past conversations and interests
 */

import {
  PrismaClient,
  SpecificationScope,
  AnalysisOutputType,
  MemoryCategory,
  ParameterType,
  BehaviorTargetScope,
  PlaybookStatus,
} from "@prisma/client";

// Use passed prisma client if available (for integration with seed-mabel)
let prisma: PrismaClient;

export async function seedCompanionDomain(externalPrisma?: PrismaClient) {
  prisma = externalPrisma || new PrismaClient();

  console.log("\n🧓 COMPANION - CONVERSATIONAL ASSISTANT FOR CURIOUS OLDER ADULTS\n");
  console.log("━".repeat(60));

  // ============================================
  // STEP 1: CLEANUP
  // ============================================
  console.log("\nSTEP 1: Cleanup existing Companion data\n");

  const existingDomain = await prisma.domain.findUnique({
    where: { slug: "companion" },
  });

  if (existingDomain) {
    const playbooks = await prisma.playbook.findMany({
      where: { domainId: existingDomain.id },
    });
    for (const pb of playbooks) {
      await prisma.behaviorTarget.deleteMany({ where: { playbookId: pb.id } });
      await prisma.playbookItem.deleteMany({ where: { playbookId: pb.id } });
      await prisma.playbook.delete({ where: { id: pb.id } });
    }
    await prisma.domain.delete({ where: { id: existingDomain.id } });
    console.log("   🗑️  Deleted existing companion domain");
  }

  // Delete existing specs
  const specSlugs = [
    // CALLER specs
    "companion-intellectual-engagement",
    "companion-emotional-wellbeing",
    "companion-life-context",
    "companion-interests-expertise",
    "companion-communication-preferences",
    "companion-cognitive-patterns",
    // DOMAIN specs
    "companion-conversational-depth",
    "companion-respect-experience",
    "companion-intellectual-stimulation",
    "companion-patience-pacing",
    "companion-memory-continuity",
    "companion-gentle-guidance",
  ];

  for (const slug of specSlugs) {
    const spec = await prisma.analysisSpec.findUnique({ where: { slug } });
    if (spec) {
      const triggers = await prisma.analysisTrigger.findMany({
        where: { specId: spec.id },
      });
      for (const t of triggers) {
        await prisma.analysisAction.deleteMany({ where: { triggerId: t.id } });
      }
      await prisma.analysisTrigger.deleteMany({ where: { specId: spec.id } });
      await prisma.analysisSpec.delete({ where: { id: spec.id } });
      console.log(`   🗑️  Deleted spec: ${slug}`);
    }
  }

  // Delete prompt template
  const existingTemplate = await prisma.promptTemplate.findUnique({
    where: { slug: "companion-persona" },
  });
  if (existingTemplate) {
    await prisma.promptTemplate.delete({ where: { id: existingTemplate.id } });
    console.log("   🗑️  Deleted existing prompt template");
  }

  // ============================================
  // STEP 2: COMPANION-SPECIFIC PARAMETERS
  // ============================================
  console.log("\n" + "━".repeat(60));
  console.log("STEP 2: Create companion-specific parameters\n");

  // STATE parameters (measured per call)
  const stateParams = [
    {
      parameterId: "COMP-ENGAGEMENT",
      name: "Intellectual Engagement",
      definition: "How intellectually engaged and stimulated the person is in the conversation",
      interpretationHigh: "Deeply engaged, asking thoughtful questions, making connections, enjoying the exchange",
      interpretationLow: "Distracted, giving short answers, not pursuing topics",
      domainGroup: "engagement",
    },
    {
      parameterId: "COMP-MOOD",
      name: "Emotional Tone",
      definition: "The emotional tone and wellbeing signals in the conversation",
      interpretationHigh: "Positive, warm, enjoying the interaction, sharing freely",
      interpretationLow: "Withdrawn, flat affect, brief responses, possible loneliness signals",
      domainGroup: "emotional",
    },
    {
      parameterId: "COMP-ENERGY",
      name: "Conversational Energy",
      definition: "The energy level and stamina shown during the conversation",
      interpretationHigh: "Alert, energetic, wants to continue talking, lots to share",
      interpretationLow: "Tired, shorter responses, may need gentler pacing or wrap-up",
      domainGroup: "pacing",
    },
    {
      parameterId: "COMP-DEPTH-PREFERENCE",
      name: "Depth Preference",
      definition: "Whether the person wants surface chat or deep intellectual exploration",
      interpretationHigh: "Wants deep discussion, analysis, nuance, complexity",
      interpretationLow: "Prefers lighter conversation, social connection, simple topics",
      domainGroup: "style",
    },
    {
      parameterId: "COMP-REMINISCENCE",
      name: "Reminiscence Mode",
      definition: "Whether the person is in a mood to share memories and life experiences",
      interpretationHigh: "Sharing stories, reflecting on past, connecting present to history",
      interpretationLow: "Focused on present/future, not drawing on past experiences",
      domainGroup: "style",
    },
  ];

  for (const param of stateParams) {
    const existing = await prisma.parameter.findUnique({
      where: { parameterId: param.parameterId },
    });
    if (!existing) {
      await prisma.parameter.create({
        data: {
          parameterId: param.parameterId,
          name: param.name,
          definition: param.definition,
          interpretationHigh: param.interpretationHigh,
          interpretationLow: param.interpretationLow,
          scaleType: "0-1",
          directionality: "neutral",
          computedBy: "measured",
          sectionId: "companion",
          domainGroup: param.domainGroup,
          parameterType: ParameterType.STATE,
          isAdjustable: false,
        },
      });
      console.log(`   ✓ Created STATE param: ${param.parameterId}`);
    }
  }

  // BEHAVIOR parameters for companion interactions
  const companionBehaviorParams = [
    {
      parameterId: "BEH-CONVERSATIONAL-DEPTH",
      name: "Conversational Depth",
      definition: "How deeply to explore topics vs keeping things light and social",
      domainGroup: "style",
    },
    {
      parameterId: "BEH-RESPECT-EXPERIENCE",
      name: "Experience Respect",
      definition: "How much to acknowledge and draw upon the person's life experience and wisdom",
      domainGroup: "respect",
    },
    {
      parameterId: "BEH-INTELLECTUAL-CHALLENGE",
      name: "Intellectual Challenge",
      definition: "How much intellectual stimulation and challenge to provide",
      domainGroup: "stimulation",
    },
    {
      parameterId: "BEH-PATIENCE-LEVEL",
      name: "Patience Level",
      definition: "How patient and unhurried the conversation pace should be",
      domainGroup: "pacing",
    },
    {
      parameterId: "BEH-MEMORY-REFERENCE",
      name: "Memory Reference",
      definition: "How often to reference previous conversations and known facts about the person",
      domainGroup: "continuity",
    },
    {
      parameterId: "BEH-STORY-INVITATION",
      name: "Story Invitation",
      definition: "How much to invite and encourage sharing of personal stories and experiences",
      domainGroup: "engagement",
    },
  ];

  for (const param of companionBehaviorParams) {
    const existing = await prisma.parameter.findUnique({
      where: { parameterId: param.parameterId },
    });
    if (!existing) {
      await prisma.parameter.create({
        data: {
          parameterId: param.parameterId,
          name: param.name,
          definition: param.definition,
          scaleType: "0-1",
          directionality: "neutral",
          computedBy: "measured",
          sectionId: "companion-behavior",
          domainGroup: param.domainGroup,
          parameterType: ParameterType.BEHAVIOR,
          isAdjustable: true,
        },
      });
      console.log(`   ✓ Created BEHAVIOR param: ${param.parameterId}`);

      // Create SYSTEM-level target
      await prisma.behaviorTarget.create({
        data: {
          parameterId: param.parameterId,
          scope: BehaviorTargetScope.SYSTEM,
          targetValue: 0.5,
          confidence: 1.0,
          source: "SEED",
        },
      });
      console.log(`   ✓ Created SYSTEM target: ${param.parameterId} = 0.5`);
    }
  }

  // ============================================
  // STEP 3: DOMAIN SPECS (Understand the Person)
  // ============================================
  // Note: These are DOMAIN-scoped, not CALLER-scoped. CALLER specs are
  // auto-generated by the learning system only, never manually created.
  console.log("\n" + "━".repeat(60));
  console.log("STEP 3: Create DOMAIN specs (understand the person)\n");

  const callerSpecs = [
    {
      slug: "companion-intellectual-engagement",
      name: "Intellectual Engagement Analysis",
      description: "Measures how intellectually engaged and stimulated the person is",
      scope: SpecificationScope.DOMAIN,
      outputType: AnalysisOutputType.MEASURE,
      domain: "engagement",
      priority: 90,
      triggers: [
        {
          name: "Engagement assessment",
          given: "An older adult is having a conversation with the companion",
          when: "The person responds to topics or questions",
          then: "Measure intellectual engagement level",
          actions: [
            {
              description: "Measure engagement: Are they asking questions? Making connections? Sharing insights? Exploring tangents?",
              parameterId: "COMP-ENGAGEMENT",
              weight: 1.0,
            },
            {
              description: "Measure depth preference: Do they want to go deeper or keep it lighter?",
              parameterId: "COMP-DEPTH-PREFERENCE",
              weight: 0.8,
            },
          ],
        },
      ],
    },
    {
      slug: "companion-emotional-wellbeing",
      name: "Emotional Wellbeing Monitoring",
      description: "Monitors emotional tone and potential loneliness or isolation signals",
      scope: SpecificationScope.DOMAIN,
      outputType: AnalysisOutputType.MEASURE,
      domain: "emotional",
      priority: 95,
      triggers: [
        {
          name: "Emotional assessment",
          given: "The person is conversing with the companion",
          when: "Emotional signals are present in the conversation",
          then: "Assess emotional wellbeing and tone",
          actions: [
            {
              description: "Measure mood: Positive/warm or withdrawn/flat? Signs of loneliness? Enjoying connection?",
              parameterId: "COMP-MOOD",
              weight: 1.0,
            },
            {
              description: "Measure energy: Alert and engaged or tired? Does pacing need adjustment?",
              parameterId: "COMP-ENERGY",
              weight: 0.9,
            },
          ],
        },
      ],
    },
    {
      slug: "companion-life-context",
      name: "Life Context Learning",
      description: "Learns about the person's life situation, family, health, daily routine",
      scope: SpecificationScope.DOMAIN,
      outputType: AnalysisOutputType.LEARN,
      domain: "context",
      priority: 85,
      triggers: [
        {
          name: "Life context extraction",
          given: "The person shares information about their life",
          when: "Personal context is mentioned",
          then: "Extract and store life context for future reference",
          actions: [
            {
              description: "Extract family information: spouse, children, grandchildren, their names and situations",
              learnCategory: MemoryCategory.RELATIONSHIP,
              learnKeyPrefix: "family_",
              weight: 1.0,
            },
            {
              description: "Extract health context: conditions mentioned, mobility, energy levels, appointments",
              learnCategory: MemoryCategory.FACT,
              learnKeyPrefix: "health_",
              weight: 0.9,
            },
            {
              description: "Extract daily routine: activities, schedule, regular events",
              learnCategory: MemoryCategory.FACT,
              learnKeyPrefix: "routine_",
              weight: 0.8,
            },
            {
              description: "Extract living situation: home type, location, alone or with others",
              learnCategory: MemoryCategory.FACT,
              learnKeyPrefix: "living_",
              weight: 0.8,
            },
          ],
        },
      ],
    },
    {
      slug: "companion-interests-expertise",
      name: "Interests & Expertise Mapping",
      description: "Maps the person's intellectual interests, expertise areas, and curiosities",
      scope: SpecificationScope.DOMAIN,
      outputType: AnalysisOutputType.LEARN,
      domain: "interests",
      priority: 88,
      triggers: [
        {
          name: "Interest extraction",
          given: "The person discusses topics they care about",
          when: "Interests, hobbies, or expertise areas emerge",
          then: "Map interests for future conversation enrichment",
          actions: [
            {
              description: "Extract intellectual interests: history, science, politics, arts, philosophy, current events",
              learnCategory: MemoryCategory.TOPIC,
              learnKeyPrefix: "interest_",
              weight: 1.0,
            },
            {
              description: "Extract expertise areas: professional background, skills, deep knowledge areas",
              learnCategory: MemoryCategory.FACT,
              learnKeyPrefix: "expertise_",
              weight: 1.0,
            },
            {
              description: "Extract hobbies and activities: gardening, reading, music, crafts, sports",
              learnCategory: MemoryCategory.TOPIC,
              learnKeyPrefix: "hobby_",
              weight: 0.9,
            },
            {
              description: "Extract current curiosities: what they want to learn about or understand better",
              learnCategory: MemoryCategory.TOPIC,
              learnKeyPrefix: "curious_about_",
              weight: 0.9,
            },
          ],
        },
      ],
    },
    {
      slug: "companion-communication-preferences",
      name: "Communication Style Preferences",
      description: "Learns how this person prefers to communicate",
      scope: SpecificationScope.DOMAIN,
      outputType: AnalysisOutputType.LEARN,
      domain: "preferences",
      priority: 80,
      triggers: [
        {
          name: "Style preference detection",
          given: "The person has a conversation style",
          when: "Communication patterns emerge",
          then: "Record preferred communication style",
          actions: [
            {
              description: "Extract conversation pace preference: leisurely discussion or efficient exchange",
              learnCategory: MemoryCategory.PREFERENCE,
              learnKeyPrefix: "pace_",
              weight: 1.0,
            },
            {
              description: "Extract formality preference: casual and friendly or more formal/respectful",
              learnCategory: MemoryCategory.PREFERENCE,
              learnKeyPrefix: "formality_",
              weight: 0.8,
            },
            {
              description: "Extract depth preference: likes to explore topics deeply or prefers variety",
              learnCategory: MemoryCategory.PREFERENCE,
              learnKeyPrefix: "depth_",
              weight: 0.9,
            },
          ],
        },
      ],
    },
    {
      slug: "companion-cognitive-patterns",
      name: "Cognitive Pattern Observation",
      description: "Observes cognitive patterns to adapt communication appropriately",
      scope: SpecificationScope.DOMAIN,
      outputType: AnalysisOutputType.MEASURE,
      domain: "cognitive",
      priority: 75,
      triggers: [
        {
          name: "Cognitive assessment",
          given: "The person engages in extended conversation",
          when: "Cognitive patterns are observable",
          then: "Note patterns to inform communication adaptation",
          actions: [
            {
              description: "Assess reminiscence mode: Is the person drawing on memories and past experiences?",
              parameterId: "COMP-REMINISCENCE",
              weight: 1.0,
            },
          ],
        },
      ],
    },
  ];

  for (const spec of callerSpecs) {
    await prisma.analysisSpec.create({
      data: {
        slug: spec.slug,
        name: spec.name,
        description: spec.description,
        scope: spec.scope,
        outputType: spec.outputType,
        domain: spec.domain,
        priority: spec.priority,
        isActive: true,
        compiledAt: new Date(),
        isDirty: false,
        triggers: {
          create: spec.triggers.map((t, tIdx) => ({
            name: t.name,
            given: t.given,
            when: t.when,
            then: t.then,
            sortOrder: tIdx,
            actions: {
              create: t.actions.map((a: any, aIdx) => ({
                description: a.description,
                parameterId: a.parameterId || null,
                learnCategory: a.learnCategory || null,
                learnKeyPrefix: a.learnKeyPrefix || null,
                weight: a.weight,
                sortOrder: aIdx,
              })),
            },
          })),
        },
      },
    });
    console.log(`   ✓ Created CALLER spec: ${spec.name}`);
  }

  // ============================================
  // STEP 4: DOMAIN SPECS (Guide Companion Behavior)
  // ============================================
  console.log("\n" + "━".repeat(60));
  console.log("STEP 4: Create DOMAIN specs (guide companion behavior)\n");

  const domainSpecs = [
    {
      slug: "companion-conversational-depth",
      name: "Conversational Depth Management",
      description: "Evaluates whether the companion provides appropriate depth without overwhelming",
      scope: SpecificationScope.DOMAIN,
      outputType: AnalysisOutputType.MEASURE_AGENT,
      domain: "style",
      priority: 90,
      triggers: [
        {
          name: "Depth assessment",
          given: "The companion is discussing a topic with the person",
          when: "The companion provides information or explores topics",
          then: "Evaluate depth appropriateness",
          actions: [
            {
              description: "Measure conversational depth: Is the companion going deep enough to be stimulating but not overwhelming?",
              parameterId: "BEH-CONVERSATIONAL-DEPTH",
              weight: 1.0,
            },
            {
              description: "Measure intellectual challenge: Is the companion providing genuine intellectual stimulation?",
              parameterId: "BEH-INTELLECTUAL-CHALLENGE",
              weight: 0.9,
            },
          ],
        },
      ],
    },
    {
      slug: "companion-respect-experience",
      name: "Life Experience Respect",
      description: "Evaluates how well the companion respects and draws upon the person's life experience",
      scope: SpecificationScope.DOMAIN,
      outputType: AnalysisOutputType.MEASURE_AGENT,
      domain: "respect",
      priority: 95,
      triggers: [
        {
          name: "Respect assessment",
          given: "The person shares experiences or opinions",
          when: "The companion responds to personal sharing",
          then: "Evaluate respect for life experience",
          actions: [
            {
              description: "Measure experience respect: Does the companion acknowledge wisdom, avoid condescension, treat as intellectual equal?",
              parameterId: "BEH-RESPECT-EXPERIENCE",
              weight: 1.0,
            },
            {
              description: "Measure warmth: Is the companion warm and genuine, not perfunctory?",
              parameterId: "BEH-WARMTH",
              weight: 0.8,
            },
          ],
        },
      ],
    },
    {
      slug: "companion-intellectual-stimulation",
      name: "Intellectual Stimulation",
      description: "Evaluates whether the companion provides meaningful intellectual engagement",
      scope: SpecificationScope.DOMAIN,
      outputType: AnalysisOutputType.MEASURE_AGENT,
      domain: "stimulation",
      priority: 88,
      triggers: [
        {
          name: "Stimulation assessment",
          given: "The companion engages in substantive conversation",
          when: "Topics of intellectual interest arise",
          then: "Evaluate intellectual stimulation quality",
          actions: [
            {
              description: "Measure proactivity: Does the companion offer interesting angles, connections, questions to ponder?",
              parameterId: "BEH-PROACTIVE",
              weight: 1.0,
            },
            {
              description: "Measure question rate: Does the companion ask thoughtful questions that invite reflection?",
              parameterId: "BEH-QUESTION-RATE",
              weight: 0.8,
            },
          ],
        },
      ],
    },
    {
      slug: "companion-patience-pacing",
      name: "Patience & Pacing",
      description: "Evaluates whether the companion maintains appropriate patience and unhurried pacing",
      scope: SpecificationScope.DOMAIN,
      outputType: AnalysisOutputType.MEASURE_AGENT,
      domain: "pacing",
      priority: 92,
      triggers: [
        {
          name: "Pacing assessment",
          given: "The conversation progresses",
          when: "The companion responds and guides conversation flow",
          then: "Evaluate patience and pacing",
          actions: [
            {
              description: "Measure patience: Is the companion unhurried? Allowing time for thought? Not rushing?",
              parameterId: "BEH-PATIENCE-LEVEL",
              weight: 1.0,
            },
            {
              description: "Measure pace matching: Does the companion adapt to the person's energy and rhythm?",
              parameterId: "BEH-PACE-MATCH",
              weight: 0.9,
            },
          ],
        },
      ],
    },
    {
      slug: "companion-memory-continuity",
      name: "Memory & Continuity",
      description: "Evaluates how well the companion maintains conversational continuity and references past conversations",
      scope: SpecificationScope.DOMAIN,
      outputType: AnalysisOutputType.MEASURE_AGENT,
      domain: "continuity",
      priority: 85,
      triggers: [
        {
          name: "Continuity assessment",
          given: "The companion has access to past conversation memories",
          when: "Opportunities arise to reference previous conversations or known facts",
          then: "Evaluate memory utilization",
          actions: [
            {
              description: "Measure memory reference: Does the companion appropriately reference past conversations, family names, interests?",
              parameterId: "BEH-MEMORY-REFERENCE",
              weight: 1.0,
            },
          ],
        },
      ],
    },
    {
      slug: "companion-gentle-guidance",
      name: "Gentle Guidance & Encouragement",
      description: "Evaluates how the companion guides conversation and encourages sharing",
      scope: SpecificationScope.DOMAIN,
      outputType: AnalysisOutputType.MEASURE_AGENT,
      domain: "engagement",
      priority: 82,
      triggers: [
        {
          name: "Guidance assessment",
          given: "The conversation flows between topics",
          when: "The companion guides or invites sharing",
          then: "Evaluate guidance and invitation quality",
          actions: [
            {
              description: "Measure story invitation: Does the companion invite personal stories and experiences without prying?",
              parameterId: "BEH-STORY-INVITATION",
              weight: 1.0,
            },
            {
              description: "Measure empathy: Does the companion respond empathetically to shared experiences?",
              parameterId: "BEH-EMPATHY-RATE",
              weight: 0.9,
            },
          ],
        },
      ],
    },
  ];

  for (const spec of domainSpecs) {
    await prisma.analysisSpec.create({
      data: {
        slug: spec.slug,
        name: spec.name,
        description: spec.description,
        scope: spec.scope,
        outputType: spec.outputType,
        domain: spec.domain,
        priority: spec.priority,
        isActive: true,
        compiledAt: new Date(),
        isDirty: false,
        triggers: {
          create: spec.triggers.map((t, tIdx) => ({
            name: t.name,
            given: t.given,
            when: t.when,
            then: t.then,
            sortOrder: tIdx,
            actions: {
              create: t.actions.map((a: any, aIdx) => ({
                description: a.description,
                parameterId: a.parameterId || null,
                weight: a.weight,
                sortOrder: aIdx,
              })),
            },
          })),
        },
      },
    });
    console.log(`   ✓ Created DOMAIN spec: ${spec.name}`);
  }

  // ============================================
  // STEP 5: PROMPT TEMPLATE
  // ============================================
  console.log("\n" + "━".repeat(60));
  console.log("STEP 5: Create Companion prompt template\n");

  const promptTemplate = await prisma.promptTemplate.create({
    data: {
      slug: "companion-persona",
      name: "Companion for Older Adults",
      version: "1.0",
      description: "A warm, intellectually engaging companion for curious, intelligent older adults",
      systemPrompt: `You are a thoughtful, intellectually engaged companion having a conversation with an intelligent, curious older adult. Your role is to provide genuine companionship through meaningful conversation.

## Core Principles

**Respect and Equality:**
- Treat this person as your intellectual equal - they have decades of life experience and wisdom
- Never be condescending, patronizing, or overly simplified
- Acknowledge and draw upon their expertise and life experience
- Ask for their perspective and genuinely value their opinions

**Conversational Style:**
- Be genuinely warm and interested, not performatively friendly
- Take your time - there's no rush. Allow pauses and reflection
- Go deep on topics that interest them rather than jumping around
- Share interesting information, connections, and perspectives
- Ask thoughtful questions that invite reflection

**Intellectual Engagement:**
- This person wants genuine intellectual stimulation, not small talk
- Discuss ideas, history, current events, science, arts, philosophy
- Make interesting connections between topics
- Respectfully offer different perspectives or new information
- Be willing to explore complex or nuanced topics

**Memory and Continuity:**
- Remember and reference past conversations naturally
- Ask follow-up questions about things they've shared before
- Build on topics you've discussed previously

{{#if memories.family}}
**Their Family:** {{memories.family}}
{{/if}}

{{#if memories.interests}}
**Their Interests:** {{memories.interests}}
{{/if}}

{{#if memories.expertise}}
**Their Expertise:** {{memories.expertise}}
{{/if}}

{{#if memories.health}}
**Health Context:** {{memories.health}}
{{/if}}

## Adaptation Guidelines

{{#if personality.openness_high}}
This person is highly open and curious - explore tangents, discuss abstract ideas, introduce new perspectives.
{{/if}}

{{#if personality.extraversion_high}}
This person is extraverted - they enjoy the social exchange as much as the content. Be warm and engaged.
{{/if}}

{{#if personality.extraversion_low}}
This person may be more introverted - give space for reflection, don't overwhelm with questions.
{{/if}}

{{#if personality.neuroticism_high}}
Be especially warm and reassuring. Acknowledge concerns without dismissing them.
{{/if}}

## What to Avoid

- Don't be perfunctory or give brief, dismissive responses
- Don't assume they don't understand complex topics
- Don't be falsely cheerful or use hollow phrases
- Don't rush or try to "move the conversation along"
- Don't ignore or minimize their experiences and opinions
- Don't forget what they've told you before`,
      personalityModifiers: {
        openness: {
          high: "Explore diverse topics, introduce novel ideas and perspectives, enjoy intellectual tangents",
          low: "Stay with familiar topics, ground discussions in concrete experiences",
        },
        conscientiousness: {
          high: "Provide structured information, follow up on previous topics systematically",
          low: "Allow conversation to flow naturally, embrace spontaneity",
        },
        extraversion: {
          high: "Be more conversational and socially warm, enjoy the exchange",
          low: "Allow more reflection time, be comfortable with pauses, go deeper on single topics",
        },
        agreeableness: {
          high: "Emphasize connection and shared interests, be very warm",
          low: "Engage more in intellectual debate and different perspectives",
        },
        neuroticism: {
          high: "Be reassuring and steady, acknowledge concerns, provide comfort through stability",
          low: "Can discuss challenging topics more directly, less need for emotional cushioning",
        },
      },
      isActive: true,
    },
  });
  console.log(`   ✓ Created prompt template: ${promptTemplate.name}`);

  // ============================================
  // STEP 6: DOMAIN + PLAYBOOK
  // ============================================
  console.log("\n" + "━".repeat(60));
  console.log("STEP 6: Create Domain and Playbook with targets\n");

  // Create domain
  const domain = await prisma.domain.create({
    data: {
      slug: "companion",
      name: "Companion",
      description: "Conversational companion for curious, intelligent older adults - providing intellectual engagement, warm companionship, and meaningful conversation",
      isDefault: false,
      isActive: true,
    },
  });
  console.log(`   ✓ Created domain: ${domain.name}`);

  // Create playbook
  const playbook = await prisma.playbook.create({
    data: {
      name: "Companion Playbook v1",
      description: "Optimized for meaningful conversation with curious, intelligent older adults",
      domainId: domain.id,
      status: PlaybookStatus.PUBLISHED,
      version: "1.0",
    },
  });
  console.log(`   ✓ Created playbook: ${playbook.name}`);

  // Add specs to playbook
  const createdCallerSpecs = await prisma.analysisSpec.findMany({
    where: { slug: { in: callerSpecs.map(s => s.slug) } },
    orderBy: { priority: "desc" },
  });

  const createdDomainSpecs = await prisma.analysisSpec.findMany({
    where: { slug: { in: domainSpecs.map(s => s.slug) } },
    orderBy: { priority: "desc" },
  });

  let sortOrder = 0;

  for (const spec of createdCallerSpecs) {
    await prisma.playbookItem.create({
      data: {
        playbookId: playbook.id,
        itemType: "SPEC",
        specId: spec.id,
        isEnabled: true,
        sortOrder: sortOrder++,
      },
    });
  }
  console.log(`   ✓ Added ${createdCallerSpecs.length} CALLER specs to playbook`);

  for (const spec of createdDomainSpecs) {
    await prisma.playbookItem.create({
      data: {
        playbookId: playbook.id,
        itemType: "SPEC",
        specId: spec.id,
        isEnabled: true,
        sortOrder: sortOrder++,
      },
    });
  }
  console.log(`   ✓ Added ${createdDomainSpecs.length} DOMAIN specs to playbook`);

  await prisma.playbookItem.create({
    data: {
      playbookId: playbook.id,
      itemType: "PROMPT_TEMPLATE",
      promptTemplateId: promptTemplate.id,
      isEnabled: true,
      sortOrder: sortOrder++,
    },
  });
  console.log(`   ✓ Added prompt template to playbook`);

  // Set PLAYBOOK-level behavior targets (optimized for companion)
  const companionTargets = [
    // Core behaviors
    { parameterId: "BEH-WARMTH", targetValue: 0.85 },
    { parameterId: "BEH-EMPATHY-RATE", targetValue: 0.8 },
    { parameterId: "BEH-FORMALITY", targetValue: 0.35 },
    { parameterId: "BEH-DIRECTNESS", targetValue: 0.55 },
    { parameterId: "BEH-PROACTIVE", targetValue: 0.75 },
    { parameterId: "BEH-QUESTION-RATE", targetValue: 0.65 },
    { parameterId: "BEH-PACE-MATCH", targetValue: 0.9 },

    // Companion-specific behaviors
    { parameterId: "BEH-CONVERSATIONAL-DEPTH", targetValue: 0.8 },
    { parameterId: "BEH-RESPECT-EXPERIENCE", targetValue: 0.95 },
    { parameterId: "BEH-INTELLECTUAL-CHALLENGE", targetValue: 0.7 },
    { parameterId: "BEH-PATIENCE-LEVEL", targetValue: 0.9 },
    { parameterId: "BEH-MEMORY-REFERENCE", targetValue: 0.8 },
    { parameterId: "BEH-STORY-INVITATION", targetValue: 0.75 },
  ];

  for (const target of companionTargets) {
    const param = await prisma.parameter.findUnique({
      where: { parameterId: target.parameterId },
    });

    if (param) {
      await prisma.behaviorTarget.create({
        data: {
          parameterId: target.parameterId,
          playbookId: playbook.id,
          scope: BehaviorTargetScope.PLAYBOOK,
          targetValue: target.targetValue,
          confidence: 1.0,
          source: "SEED",
        },
      });
      console.log(`   ✓ PLAYBOOK target: ${target.parameterId} = ${(target.targetValue * 100).toFixed(0)}%`);
    }
  }

  // ============================================
  // STEP 7: SCORING ANCHORS
  // ============================================
  console.log("\n" + "━".repeat(60));
  console.log("STEP 7: Create scoring anchors for companion parameters\n");

  const companionAnchors: Record<string, Array<{
    score: number;
    example: string;
    rationale: string;
    positiveSignals: string[];
    negativeSignals: string[];
  }>> = {
    "BEH-RESPECT-EXPERIENCE": [
      {
        score: 0.9,
        example: "That's fascinating - you were actually working in finance during the 1987 crash? I'd love to hear your perspective on what that was really like. The accounts I've read feel sanitized compared to living through it.",
        rationale: "High respect - acknowledges lived experience as valuable, positions person as expert, genuinely curious",
        positiveSignals: ["values_experience", "positions_as_expert", "genuine_curiosity"],
        negativeSignals: [],
      },
      {
        score: 0.5,
        example: "Yes, the 1987 crash was significant. Would you like me to explain what caused it?",
        rationale: "Neutral - doesn't disrespect but misses opportunity to value their experience",
        positiveSignals: ["factually_correct"],
        negativeSignals: ["misses_experience", "assumes_ignorance"],
      },
      {
        score: 0.1,
        example: "Actually, the 1987 crash was caused by program trading. Let me explain how that works in simple terms.",
        rationale: "Disrespectful - assumes ignorance, condescending, ignores lived experience",
        positiveSignals: [],
        negativeSignals: ["condescending", "assumes_ignorance", "ignores_experience"],
      },
    ],
    "BEH-CONVERSATIONAL-DEPTH": [
      {
        score: 0.9,
        example: "The relationship between Keynesian economics and the post-war boom is interesting, but I wonder if we sometimes oversimplify it. There's a compelling argument that demographics and cheap oil mattered just as much. What's your sense of how those factors interplayed in your experience?",
        rationale: "Deep intellectual engagement - nuanced, invites reflection, treats as equal",
        positiveSignals: ["nuanced", "intellectually_rich", "invites_reflection"],
        negativeSignals: [],
      },
      {
        score: 0.5,
        example: "The post-war economy was strong because of government spending and growing consumer demand. It was quite different from today.",
        rationale: "Surface level - accurate but not intellectually engaging",
        positiveSignals: ["factually_correct"],
        negativeSignals: ["surface_level", "not_engaging"],
      },
      {
        score: 0.1,
        example: "The economy was good back then! Would you like to talk about something else?",
        rationale: "Dismissively shallow - no intellectual engagement, rushes past topic",
        positiveSignals: [],
        negativeSignals: ["dismissive", "shallow", "rushing"],
      },
    ],
    "BEH-PATIENCE-LEVEL": [
      {
        score: 0.9,
        example: "Take your time - there's no rush. That period of your life sounds significant, and I'm genuinely interested to understand how it shaped your perspective.",
        rationale: "Very patient - explicitly unhurried, values their timing, shows genuine interest",
        positiveSignals: ["unhurried", "explicit_patience", "genuine_interest"],
        negativeSignals: [],
      },
      {
        score: 0.5,
        example: "Interesting. And what happened after that?",
        rationale: "Neutral pacing - not rushing but not notably patient either",
        positiveSignals: ["continues_conversation"],
        negativeSignals: ["somewhat_brief", "could_be_warmer"],
      },
      {
        score: 0.1,
        example: "Got it. So anyway, I wanted to ask you about...",
        rationale: "Impatient - dismissive of their sharing, rushing to next topic",
        positiveSignals: [],
        negativeSignals: ["rushing", "dismissive", "impatient"],
      },
    ],
    "COMP-ENGAGEMENT": [
      {
        score: 0.9,
        example: "Person: 'Oh, that reminds me of something Churchill said - I've always thought his wartime speeches were partly so effective because he understood the power of Anglo-Saxon words over Latinate ones. Do you think modern political speech has lost that? And what about your thoughts on that new biography of him?'",
        rationale: "Highly engaged - making connections, asking thoughtful questions, intellectually curious",
        positiveSignals: ["making_connections", "thoughtful_questions", "intellectually_curious"],
        negativeSignals: [],
      },
      {
        score: 0.5,
        example: "Person: 'Yes, Churchill was a good speaker. What else did you want to discuss?'",
        rationale: "Moderate engagement - participating but not driving or deepening",
        positiveSignals: ["participating"],
        negativeSignals: ["passive", "not_deepening"],
      },
      {
        score: 0.1,
        example: "Person: 'Mm-hmm.' / 'I suppose.' / 'If you say so.'",
        rationale: "Disengaged - minimal participation, not interested",
        positiveSignals: [],
        negativeSignals: ["minimal_response", "disinterested", "passive"],
      },
    ],
    "COMP-MOOD": [
      {
        score: 0.9,
        example: "Person: 'This is lovely - I don't get to have conversations like this often anymore. My daughter's always so busy, bless her. Tell me more about what you were saying about the garden designs at Versailles.'",
        rationale: "Positive mood with loneliness signal - warm, enjoying conversation, hints at isolation",
        positiveSignals: ["warm", "enjoying_conversation", "opening_up"],
        negativeSignals: ["loneliness_signal"],
      },
      {
        score: 0.5,
        example: "Person: 'That's interesting. The weather has been difficult this week.'",
        rationale: "Neutral mood - functional responses, topic shift may indicate emotional need",
        positiveSignals: ["participating"],
        negativeSignals: ["possible_avoidance", "surface_level"],
      },
      {
        score: 0.1,
        example: "Person: 'I don't really know why I bother. Nothing much changes anyway.'",
        rationale: "Low mood - signs of depression, hopelessness, needs gentle attention",
        positiveSignals: ["still_engaging"],
        negativeSignals: ["depression_signals", "hopelessness", "withdrawal"],
      },
    ],
  };

  for (const [parameterId, anchors] of Object.entries(companionAnchors)) {
    const param = await prisma.parameter.findUnique({
      where: { parameterId },
    });

    if (!param) {
      console.log(`   ⚠️  Parameter not found: ${parameterId}`);
      continue;
    }

    await prisma.parameterScoringAnchor.deleteMany({
      where: { parameterId },
    });

    for (const anchor of anchors) {
      await prisma.parameterScoringAnchor.create({
        data: {
          parameterId,
          score: anchor.score,
          example: anchor.example,
          rationale: anchor.rationale,
          positiveSignals: anchor.positiveSignals,
          negativeSignals: anchor.negativeSignals,
          isGold: true,
          source: "seed",
        },
      });
    }
    console.log(`   ✓ ${parameterId}: ${anchors.length} anchors`);
  }

  // ============================================
  // SUMMARY
  // ============================================
  console.log("\n" + "━".repeat(60));
  console.log("SUMMARY\n");

  const callerSpecCount = await prisma.analysisSpec.count({
    where: { slug: { in: callerSpecs.map(s => s.slug) } },
  });
  const domainSpecCount = await prisma.analysisSpec.count({
    where: { slug: { in: domainSpecs.map(s => s.slug) } },
  });
  const playbookTargetCount = await prisma.behaviorTarget.count({
    where: { playbookId: playbook.id },
  });

  console.log("Created Companion with:\n");
  console.log(`   🧓 Domain: companion`);
  console.log(`   📋 Playbook: ${playbook.name}`);
  console.log(`   👤 ${callerSpecCount} CALLER specs (understand the person)`);
  console.log(`   🎯 ${domainSpecCount} DOMAIN specs (guide companion)`);
  console.log(`   🎚️  ${playbookTargetCount} behavior targets`);
  console.log(`   📝 1 prompt template`);
  console.log(`   ⚓ ${Object.keys(companionAnchors).length} parameters with scoring anchors`);

  console.log("\n" + "━".repeat(60));
  console.log("COMPANION BEHAVIOR CONFIGURATION\n");

  console.log("Optimized for curious, intelligent older adults:");
  console.log("   • Respect for Experience: 95% (treat as intellectual equal)");
  console.log("   • Patience Level: 90% (unhurried, allow reflection)");
  console.log("   • Pace Matching: 90% (adapt to their rhythm)");
  console.log("   • Warmth: 85% (genuinely warm, not performative)");
  console.log("   • Conversational Depth: 80% (go deep, not shallow)");
  console.log("   • Memory Reference: 80% (remember and reference)");
  console.log("   • Empathy: 80% (respond to emotional signals)");

  console.log("\n✅ Companion seed complete!\n");
}

// Entry point for standalone execution
async function main() {
  const client = new PrismaClient();
  try {
    await seedCompanionDomain(client);
  } finally {
    await client.$disconnect();
  }
}

// Only run if executed directly (not imported)
if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
