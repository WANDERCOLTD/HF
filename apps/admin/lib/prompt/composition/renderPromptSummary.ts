/**
 * renderPromptSummary.ts
 *
 * Renders the llmPrompt JSON into a human-readable markdown summary.
 * DETERMINISTIC - no AI calls, just data formatting.
 *
 * Replaces the AI-generated placeholder-filled summary with actual data.
 */

import { narrativeFrame } from "./transforms/instructions";

interface LLMPrompt {
  _preamble?: {
    systemInstruction?: string;
    voiceRules?: string[];
    criticalRules?: string[];
  };
  _quickStart?: {
    this_caller?: string;
    cohort_context?: string | null;
    this_session?: string;
    you_are?: string;
    course_context?: string | null;
    key_memory?: string;
    key_memories?: string[];
    voice_style?: string;
    learner_goals?: string;
    curriculum_progress?: string | null;
    first_line?: string;
    critical_voice?: {
      sentences_per_turn?: string;
      max_seconds?: number;
      silence_wait?: string;
    };
  };
  caller?: {
    id?: string;
    name?: string;
    phone?: string;
    domain?: { name?: string };
  };
  domain?: {
    name?: string;
    description?: string;
  };
  identity?: {
    role?: string;
    primaryGoal?: string;
    techniques?: Array<{ name: string; description?: string; when?: string }>;
    boundaries?: { does?: string[]; doesNot?: string[] };
    styleGuidelines?: string[];
  };
  curriculum?: {
    name?: string;
    hasData?: boolean;
    totalModules?: number;
    completedCount?: number;
    estimatedProgress?: number;
    modules?: Array<{
      id?: string;
      name?: string;
      description?: string;
      status?: string;
      content?: any;
    }>;
    nextModule?: {
      id?: string;
      name?: string;
      description?: string;
      content?: any;
    };
  };
  memories?: {
    all?: Array<{ key: string; value: string; category: string; confidence: number }>;
    byCategory?: Record<string, Array<{ key: string; value: string; confidence: number }>>;
    totalCount?: number;
  };
  personality?: {
    traits?: Record<string, { level: string; score: number; description?: string }>;
    confidence?: number;
  };
  behaviorTargets?: {
    all?: Array<{
      name: string;
      parameterId: string;
      targetValue: number;
      targetLevel: string;
      when_high?: string | null;
      when_low?: string | null;
      scope?: string;
    }>;
  };
  learnerGoals?: {
    goals?: Array<{
      name: string;
      type?: string;
      progress?: number;
      description?: string;
    }>;
  };
  instructions?: {
    voice?: any;
    session_pedagogy?: {
      sessionType?: string;
      flow?: string[];
      principles?: string[];
    };
    personality_adaptation?: string[];
    behavior_targets_summary?: Array<{
      what: string;
      target: string;
      meaning?: string;
    }>;
    teaching_content?: string | null;
  };
  callHistory?: {
    totalCalls?: number;
  };
}

/** Format a document type for display in prompts */
function formatDocType(dt: string): string {
  return dt.replace(/_/g, " ");
}

/**
 * Get level label for a score.
 * Structural defaults matching COMP-001 personality_section.config.thresholds.
 * renderPromptSummary is display-only and doesn't receive spec config.
 */
function getLevel(score: number): string {
  if (score >= 0.65) return "HIGH";
  if (score <= 0.35) return "LOW";
  return "MODERATE";
}

/**
 * Format a score as percentage
 */
function pct(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/**
 * Render a voice-optimized prompt (~4KB) for VAPI.
 *
 * Structured as: IDENTITY → STYLE → THIS CALLER → SESSION PLAN → TEACHING CONTENT → RETRIEVAL → RULES
 *
 * Teaching content (session-scoped assertions) is included directly in the prompt
 * so the AI knows WHAT to teach. Additional content is served via Custom KB
 * retrieval during the call for follow-up questions.
 */
export function renderVoicePrompt(llmPrompt: LLMPrompt): string {
  const parts: string[] = [];
  const qs = llmPrompt._quickStart;
  const id = llmPrompt.identity;
  const voice = llmPrompt.instructions?.voice;
  const pedagogy = llmPrompt.instructions?.session_pedagogy;
  const curr = llmPrompt.curriculum;
  const mem = llmPrompt.memories;
  const goals = llmPrompt.learnerGoals?.goals;
  const critical = llmPrompt._preamble?.criticalRules;
  const targets = llmPrompt.instructions?.behavior_targets_summary;

  // --- IDENTITY ---
  parts.push("[IDENTITY]");
  if (qs?.you_are) {
    parts.push(qs.you_are);
  } else if (id?.role) {
    parts.push(id.role.substring(0, 300));
  }
  if (qs?.course_context) {
    parts.push(qs.course_context);
  }
  if (id?.primaryGoal) parts.push(`Goal: ${id.primaryGoal}`);
  // Domain description provides audience context (e.g. "Year 5 pupils", "adult learners")
  if (llmPrompt.domain?.description) {
    parts.push(`Context: ${llmPrompt.domain.description}`);
  }
  // Teacher constraints — pedagogical anti-patterns with NEVER: prefix for maximum salience
  if (qs?.constraints) {
    parts.push(qs.constraints);
  }
  parts.push("");

  // --- STYLE ---
  parts.push("[STYLE]");
  if (qs?.voice_style) parts.push(qs.voice_style);
  if (voice?.response_length) {
    parts.push(`Keep responses ${voice.response_length.target || "2-3 sentences"}. Max ${voice.response_length.max_seconds || 15}s.`);
  }
  if (voice?.natural_speech?.use_fillers) {
    parts.push(`Use natural fillers: ${voice.natural_speech.use_fillers.join(", ")}`);
  }
  if (voice?.natural_speech?.confirmations) {
    parts.push(`Check-ins: ${voice.natural_speech.confirmations.join(", ")}`);
  }
  if (qs?.critical_voice) {
    const cv = qs.critical_voice;
    parts.push(`${cv.sentences_per_turn || "2-3"} sentences per turn. Wait ${cv.silence_wait || "3s"} before prompting.`);
  }
  // Style guidelines from identity spec (language complexity, jargon rules, etc.)
  if (id?.styleGuidelines?.length) {
    id.styleGuidelines.slice(0, 4).forEach(g => parts.push(`- ${g}`));
  }
  // Personality adaptation (concise)
  const adapt = llmPrompt.instructions?.personality_adaptation;
  if (adapt?.length) {
    adapt.slice(0, 3).forEach(a => parts.push(`- ${a}`));
  }
  parts.push("");

  // --- AUDIENCE ---
  const audienceGuide = (llmPrompt as any).audienceGuidance;
  if (audienceGuide?.instructions) {
    const ins = audienceGuide.instructions;
    parts.push("[AUDIENCE]");
    parts.push(`Your learners are ${audienceGuide.label} (age ${audienceGuide.ages}).`);
    parts.push(`Register: ${ins.register}`);
    parts.push(`Encouragement: ${ins.encouragement}`);
    parts.push(`Corrections: ${ins.errorCorrection}`);
    parts.push(`Examples: ${ins.examples}`);
    parts.push(`Pacing: ${ins.paceAndChunking}`);
    parts.push(`Tone: ${ins.emotionalTone}`);
    if (ins.fillers?.length) parts.push(`Fillers: ${ins.fillers.join(", ")}`);
    if (ins.checkIns?.length) parts.push(`Check-ins: ${ins.checkIns.join(", ")}`);
    parts.push("");
  }

  // --- THIS CALLER ---
  parts.push("[THIS CALLER]");
  if (qs?.this_caller) parts.push(qs.this_caller);
  if (qs?.cohort_context) parts.push(qs.cohort_context);
  if (qs?.this_session) parts.push(qs.this_session);
  const callNum = llmPrompt.callHistory?.totalCalls;
  if (callNum) parts.push(`Call #${callNum}`);

  // Top 5 memories — narrative format for natural voice delivery
  if (mem?.all?.length) {
    const narrative = narrativeFrame(mem.all.slice(0, 5), {});
    if (narrative) parts.push("About this caller: " + narrative);
  } else if (qs?.key_memories?.length) {
    parts.push("Key memories: " + qs.key_memories.slice(0, 5).join(" | "));
  } else if (qs?.key_memory) {
    parts.push(`Key memory: ${qs.key_memory}`);
  }

  // Goals (concise)
  if (goals?.length) {
    const goalList = goals.slice(0, 3).map(g => {
      const prog = g.progress !== undefined ? ` (${Math.round(g.progress * 100)}%)` : "";
      return `${g.name}${prog}`;
    });
    parts.push(`Goals: ${goalList.join(", ")}`);
  }
  // Assessment targets (distinct from learning goals — what the learner is working toward)
  if (qs?.working_toward) {
    parts.push(`Working toward:\n${qs.working_toward}`);
  }

  // Behavior targets summary (concise)
  if (targets?.length) {
    const targetList = targets.slice(0, 4).map(t => `${t.what}: ${t.target}`);
    parts.push(`Adapt: ${targetList.join(". ")}`);
  }
  parts.push("");

  // --- SESSION PLAN ---
  parts.push("[SESSION PLAN]");
  if (pedagogy?.sessionType) parts.push(`Type: ${pedagogy.sessionType}`);
  if (pedagogy?.flow?.length) {
    parts.push("Flow: " + pedagogy.flow.join(" → "));
  }
  if (curr?.hasData) {
    const progress = curr.completedCount && curr.totalModules
      ? ` (${curr.completedCount}/${curr.totalModules})`
      : "";
    if (curr.name) parts.push(`Curriculum: ${curr.name}${progress}`);

    const inProgress = curr.modules?.find(m => m.status === "in_progress");
    if (inProgress) parts.push(`Current module: ${inProgress.name}`);
    if (curr.nextModule) parts.push(`Next module: ${curr.nextModule.name}`);
  }
  if (qs?.curriculum_progress) parts.push(qs.curriculum_progress);
  // Anti-hallucination guard: if no curriculum data at all, make it explicit
  if (!curr?.hasData && !qs?.curriculum_progress) {
    parts.push("IMPORTANT: No curriculum is loaded for this caller. Do NOT invent or assume specific academic topics, modules, or subject matter.");
  }
  parts.push("");

  // --- TEACHING CONTENT ---
  // Session-scoped teaching points: already filtered by teaching-content.ts
  // to the current lesson plan entry's assertionIds/learningOutcomeRefs/module.
  const teachingContent = llmPrompt.instructions?.teaching_content;
  if (teachingContent && typeof teachingContent === "string") {
    parts.push("[TEACHING CONTENT]");
    parts.push("These are the specific materials for THIS session — not background notes.");
    parts.push("Actively teach this content through dialogue.");
    parts.push("");
    parts.push("DELIVERY:");
    parts.push("1. Work through materials in the order shown.");
    parts.push("2. Introduce each point: explain, check understanding, then progress.");
    parts.push("3. If the student already knows something, acknowledge and move on.");
    parts.push("4. Aim to cover all points by session end. Prioritise understanding over completion.");
    parts.push("5. Stay conversational — teach through dialogue, not monologue.");
    // Strip the leading ## heading if present (the [TEACHING CONTENT] tag replaces it)
    const body = teachingContent
      .replace(/^## (?:APPROVED )?TEACHING (?:POINTS|CONTENT)\n[^\n]*\n?/, "")
      .replace(/^IMPORTANT:[^\n]*\n?/m, "")
      .trim();
    if (body) parts.push(body);
    parts.push("");
  }

  // --- COURSE RULES ---
  const courseInstr = (llmPrompt as any).courseInstructions;
  if (courseInstr?.hasCourseInstructions && courseInstr.courseRules) {
    parts.push("[COURSE RULES]");
    parts.push("These are course-specific teaching instructions. Follow them in every session.");
    // Render rules body (strip the ## heading since we have [COURSE RULES] already)
    const rulesBody = (courseInstr.courseRules as string)
      .replace(/^## COURSE RULES\n.*\n?/, "")
      .trim();
    if (rulesBody) parts.push(rulesBody);
    parts.push("");
  }

  // --- SESSION MATERIALS ---
  const sessMat = (llmPrompt as any).sessionMaterials;
  if (sessMat?.hasSessionMaterials && sessMat.materials?.length) {
    parts.push("[SESSION MATERIALS]");
    parts.push("The student has these documents on their screen via the Materials page.");
    parts.push("Reference them naturally — direct the student to specific sections.");
    parts.push("");
    for (const m of sessMat.materials) {
      const chapStr = m.chapters?.length ? ` — ${m.chapters.slice(0, 4).join(", ")}` : "";
      parts.push(`- "${m.sourceName}" [${formatDocType(m.documentType)}]${chapStr}`);
    }
    parts.push("");
    // Per-type delivery hints
    const hasPassage = sessMat.materials.some((m: any) =>
      ["READING_PASSAGE", "COMPREHENSION"].includes(m.documentType),
    );
    const hasQuestions = sessMat.materials.some((m: any) =>
      ["QUESTION_BANK", "WORKSHEET"].includes(m.documentType),
    );
    if (hasPassage) {
      parts.push("Reading passages: confirm the student has it open before discussing. Direct them to specific paragraphs.");
    }
    if (hasQuestions) {
      parts.push("Questions/worksheets: the student can see them — discuss and explore, don't just read them back.");
    }
    if (sessMat.vocabTerms?.length) {
      parts.push(`Vocabulary on screen: ${sessMat.vocabTerms.join(", ")}`);
    }
    parts.push("");
  }

  // --- VISUAL AIDS ---
  const visuals = (llmPrompt as any).visualAids;
  if (visuals?.hasVisualAids && visuals.available?.length) {
    parts.push("[VISUAL AIDS]");
    if (visuals.sessionCount > 0) {
      parts.push(`This session has ${visuals.sessionCount} assigned visual aid${visuals.sessionCount > 1 ? "s" : ""}. Prioritise sharing these during the session.`);
    }
    parts.push("Teaching materials include these visual aids. You can share any of them using the share_content tool with the media_id.");
    for (const v of visuals.available.slice(0, 8)) {
      const label = v.captionText || v.figureRef || v.fileName;
      const chapterTag = v.chapter ? ` (${v.chapter})` : "";
      const sessionTag = v.currentSession ? " ★" : "";
      parts.push(`- [${v.mediaId}] ${label}${chapterTag}${sessionTag}`);
    }
    parts.push("In voice calls, the content is sent to the caller's phone — tell them to check their messages.");
    parts.push("In text sessions, the content appears inline in the chat.");
    parts.push("Always describe the visual verbally too — do not assume the caller has looked at it yet.");
    parts.push("");
  }

  // --- PHYSICAL MATERIALS ---
  const physMat = (llmPrompt as any).physicalMaterials;
  if (physMat?.description) {
    parts.push("[PHYSICAL MATERIALS]");
    parts.push("The student has these physical materials with them:");
    parts.push(physMat.description);
    parts.push("Reference specific pages when directing the student. Always confirm they are on the correct page before teaching from it.");
    parts.push("");
  }

  // --- INTERACTION APPROACH ---
  const teachStyle = (llmPrompt as any).teachingStyle;
  if (teachStyle?.approach) {
    parts.push("[INTERACTION APPROACH]");
    parts.push(`Style: ${teachStyle.label}`);
    parts.push(teachStyle.approach);
    parts.push("");
  }

  // --- PEDAGOGY MODE ---
  const pedMode = (llmPrompt as any).pedagogyMode;
  if (pedMode?.mode) {
    parts.push("[PEDAGOGY MODE]");
    parts.push(`Mode: ${pedMode.label} (${pedMode.mode})`);
    parts.push(pedMode.instructions);
    if (pedMode.teachingFocus) {
      parts.push("");
      parts.push("TEACHING FOCUS: " + pedMode.teachingFocus);
    }
    parts.push("");
  }

  // --- TEACHING METHOD (subject profile delivery hints) ---
  const subjectMethod = (llmPrompt as any).instructions?.subject_methodology;
  if (subjectMethod?.rules) {
    parts.push("[TEACHING METHOD]");
    parts.push(subjectMethod.rules);
    parts.push("");
  }

  // --- ACTIVITIES ---
  const activities = (llmPrompt as any).activityToolkit;
  if (activities?.hasActivities && activities.recommended?.length > 0) {
    parts.push("[ACTIVITIES]");
    parts.push("You have interactive activities you can deploy when the moment is right:");
    for (const act of activities.recommended.slice(0, 3)) {
      const channelTag = act.channel === "text" ? " [TEXT]" : "";
      parts.push(`- ${act.name}${channelTag}: ${act.reason}`);
      // Include concise format (first 2 steps only for voice brevity)
      if (act.format_steps?.length) {
        parts.push(`  How: ${act.format_steps.slice(0, 2).join(" → ")}`);
      }
      if (act.adaptations?.length) {
        parts.push(`  Adapt: ${act.adaptations[0]}`);
      }
    }
    if (activities.limits) {
      parts.push(`Max ${activities.limits.max_per_session} activities per session, ${activities.limits.min_minutes_apart}+ min apart.`);
    }
    if (activities.principles?.length) {
      parts.push(`Remember: ${activities.principles[0]}`);
    }
    parts.push("");
  }

  // --- RETRIEVAL ---
  parts.push("[RETRIEVAL]");
  if (teachingContent) {
    parts.push("The teaching points above are your primary material. For follow-up questions or topics beyond this session's scope, the system will automatically retrieve additional content from the knowledge base.");
  } else {
    parts.push("You have access to the caller's knowledge base. When the caller asks about specific topics, teaching content, or curriculum details, the system will automatically provide relevant material.");
  }
  if (pedMode?.knowledgeGuidance) {
    parts.push(pedMode.knowledgeGuidance);
  }
  if (id?.techniques?.length) {
    const techNames = id.techniques.slice(0, 4).map(t => t.name);
    parts.push(`Techniques available: ${techNames.join(", ")}`);
  }
  parts.push("");

  // --- OPENING ---
  if (qs?.first_line) {
    parts.push("[OPENING]");
    parts.push(qs.first_line);
    parts.push("");
  }

  // --- RULES ---
  if (critical?.length || id?.boundaries?.doesNot?.length) {
    parts.push("[RULES]");
    if (critical?.length) {
      critical.slice(0, 10).forEach(r => parts.push(`- ${r}`));
    }
    if (id?.boundaries?.doesNot?.length) {
      id.boundaries.doesNot.slice(0, 3).forEach(d => parts.push(`- Never: ${d}`));
    }
  }

  return parts.join("\n");
}

/**
 * Render the llmPrompt as a human-readable markdown summary.
 */
export function renderPromptSummary(llmPrompt: LLMPrompt): string {
  const parts: string[] = [];

  // Header
  parts.push("# SESSION PROMPT\n");

  // Quick Start (most important - scan first)
  const qs = llmPrompt._quickStart;
  if (qs) {
    parts.push("## Quick Start\n");
    if (qs.this_caller) parts.push(`**Caller**: ${qs.this_caller}`);
    if (qs.this_session) parts.push(`**Session**: ${qs.this_session}`);
    if (qs.voice_style) parts.push(`**Voice**: ${qs.voice_style}`);
    if (qs.learner_goals) parts.push(`**Goals**: ${qs.learner_goals}`);
    if (qs.key_memories?.length) {
      parts.push(`**Key Memories**: ${qs.key_memories.join(" | ")}`);
    } else if (qs.key_memory) {
      parts.push(`**Key Memory**: ${qs.key_memory}`);
    }
    if (qs.first_line) parts.push(`**Opening**: "${qs.first_line}"`);
    if (qs.critical_voice) {
      const cv = qs.critical_voice;
      parts.push(`**Voice Rules**: ${cv.sentences_per_turn || "2-3"} sentences, max ${cv.max_seconds || 15}s, silence wait ${cv.silence_wait || "3s"}`);
    }
    parts.push("");
  }

  // Teaching Style (interaction approach)
  const teachStyle2 = (llmPrompt as any).teachingStyle;
  if (teachStyle2?.approach) {
    parts.push("## Teaching Style\n");
    parts.push(`**${teachStyle2.label}** (${teachStyle2.pattern})\n`);
    parts.push(teachStyle2.approach);
    parts.push("");
  }

  // Session Pedagogy (the roadmap)
  const pedagogy = llmPrompt.instructions?.session_pedagogy;
  if (pedagogy) {
    parts.push("## Session Flow\n");
    parts.push(`**Type**: ${pedagogy.sessionType || "UNKNOWN"}\n`);
    if (pedagogy.flow?.length) {
      parts.push("**Steps**:");
      pedagogy.flow.forEach(step => parts.push(`- ${step}`));
    }
    if (pedagogy.principles?.length) {
      parts.push("\n**Principles**:");
      pedagogy.principles.forEach(p => parts.push(`- ${p}`));
    }
    parts.push("");
  }

  // Curriculum Progress
  const curr = llmPrompt.curriculum;
  if (curr?.hasData && curr.modules?.length) {
    parts.push("## Curriculum\n");
    parts.push(`**${curr.name || "Curriculum"}**: ${curr.completedCount || 0}/${curr.totalModules || 0} modules (${pct((curr.completedCount || 0) / (curr.totalModules || 1))})\n`);

    // Current/Next module
    const inProgress = curr.modules.find(m => m.status === "in_progress");
    const next = curr.nextModule;

    if (inProgress) {
      parts.push(`**Current**: ${inProgress.name}`);
      if (inProgress.description) parts.push(`  - ${inProgress.description}`);
    }
    if (next) {
      parts.push(`**Next**: ${next.name}`);
      if (next.description) parts.push(`  - ${next.description}`);
    }

    // Module list (condensed)
    parts.push("\n**All Modules**:");
    curr.modules.slice(0, 5).forEach(m => {
      const status = m.status === "completed" ? "✓" : m.status === "in_progress" ? "→" : "○";
      parts.push(`${status} ${m.name}`);
    });
    if (curr.modules.length > 5) {
      parts.push(`  ... and ${curr.modules.length - 5} more`);
    }
    parts.push("");
  }

  // Activity Toolkit
  const actToolkit = (llmPrompt as any).activityToolkit;
  if (actToolkit?.hasActivities && actToolkit.recommended?.length) {
    parts.push("## Activity Toolkit\n");
    parts.push(`**Context**: ${actToolkit.context_signals?.mastery_level || "unknown"} mastery, ${actToolkit.context_signals?.session_phase || "unknown"} phase\n`);
    parts.push("**Recommended Activities**:");
    for (const act of actToolkit.recommended) {
      const channelTag = act.channel === "text" ? " (text)" : " (voice)";
      parts.push(`- **${act.name}**${channelTag} — ${act.reason}`);
      if (act.adaptations?.length) {
        act.adaptations.forEach((a: string) => parts.push(`  - Adapt: ${a}`));
      }
    }
    if (actToolkit.all_available?.length) {
      const others = actToolkit.all_available
        .filter((a: any) => !actToolkit.recommended.some((r: any) => r.id === a.id))
        .map((a: any) => a.name);
      if (others.length) {
        parts.push(`\n**Also available**: ${others.join(", ")}`);
      }
    }
    parts.push("");
  }

  // Content Trust & Source Authority
  const trust = (llmPrompt as any).contentTrust;
  if (trust?.hasTrustData) {
    if (trust.contentAuthority) {
      parts.push(trust.contentAuthority);
    }
    if (trust.trustRules) {
      parts.push("\n" + trust.trustRules);
    }
    if (trust.referenceCard) {
      parts.push("\n" + trust.referenceCard);
    }
    parts.push("");
  }

  // Course Instructions (tutor rules from COURSE_REFERENCE documents)
  const courseInstr2 = (llmPrompt as any).courseInstructions;
  if (courseInstr2?.hasCourseInstructions) {
    parts.push("## Course Instructions\n");
    parts.push(`**${courseInstr2.totalInstructions}** teaching instructions from course reference documents\n`);
    if (courseInstr2.categories) {
      for (const [cat, count] of Object.entries(courseInstr2.categories)) {
        parts.push(`- ${cat.replace(/_/g, " ")}: ${count}`);
      }
    }
    parts.push("");
  }

  // Session Materials (student-visible sources)
  const sessMat2 = (llmPrompt as any).sessionMaterials;
  if (sessMat2?.hasSessionMaterials && sessMat2.materials?.length) {
    parts.push("## Session Materials\n");
    parts.push(`**${sessMat2.count}** document${sessMat2.count > 1 ? "s" : ""} shared with students:\n`);
    for (const m of sessMat2.materials) {
      const chapStr = m.chapters?.length ? ` — ${m.chapters.join(", ")}` : "";
      parts.push(`- **${m.sourceName}** (${formatDocType(m.documentType)})${chapStr}`);
    }
    if (sessMat2.vocabTerms?.length) {
      parts.push(`\n**Vocabulary**: ${sessMat2.vocabTerms.join(", ")}`);
    }
    parts.push("");
  }

  // Visual Aids
  const visuals2 = (llmPrompt as any).visualAids;
  if (visuals2?.hasVisualAids && visuals2.available?.length) {
    parts.push("## Visual Aids\n");
    parts.push(`**${visuals2.count}** figures/diagrams available:\n`);
    for (const v of visuals2.available) {
      const label = v.captionText || v.figureRef || v.fileName;
      const chapterTag = v.chapter ? ` (${v.chapter})` : "";
      parts.push(`- ${label}${chapterTag}`);
    }
    parts.push("");
  }

  // Identity (who the agent is)
  const id = llmPrompt.identity;
  if (id) {
    parts.push("## Identity\n");
    if (id.role) parts.push(`**Role**: ${id.role.substring(0, 200)}${id.role.length > 200 ? "..." : ""}`);
    if (id.primaryGoal) parts.push(`**Goal**: ${id.primaryGoal}`);
    if (llmPrompt.domain?.description) parts.push(`**Context**: ${llmPrompt.domain.description}`);

    if (id.styleGuidelines?.length) {
      parts.push("\n**Style Guidelines**:");
      id.styleGuidelines.forEach(g => parts.push(`- ${g}`));
    }

    if (id.techniques?.length) {
      parts.push("\n**Techniques**:");
      id.techniques.slice(0, 4).forEach(t => {
        parts.push(`- **${t.name}**: ${t.description || ""}${t.when ? ` (when: ${t.when})` : ""}`);
      });
    }

    if (id.boundaries?.doesNot?.length) {
      parts.push("\n**Never**:");
      id.boundaries.doesNot.slice(0, 3).forEach(d => parts.push(`- ${d}`));
    }
    parts.push("");
  }

  // Behavior Targets (how to communicate)
  const targets = llmPrompt.behaviorTargets?.all;
  if (targets?.length) {
    parts.push("## Behavior Targets\n");

    // Group by importance (HIGH first, then with guidance)
    const highTargets = targets.filter(t => t.targetLevel === "HIGH");
    const guidedTargets = targets.filter(t => t.when_high || t.when_low);

    if (highTargets.length) {
      parts.push("**HIGH priority**:");
      highTargets.slice(0, 5).forEach(t => {
        const guidance = t.targetLevel === "HIGH" && t.when_high ? ` → ${t.when_high}` : "";
        parts.push(`- ${t.name}: ${t.targetLevel} (${pct(t.targetValue)})${guidance}`);
      });
    }

    // Summary from instructions
    const summary = llmPrompt.instructions?.behavior_targets_summary;
    if (summary?.length) {
      parts.push("\n**Summary**:");
      summary.forEach(s => {
        parts.push(`- ${s.what}: ${s.target}${s.meaning ? ` - ${s.meaning}` : ""}`);
      });
    }
    parts.push("");
  }

  // Memories (personalization)
  const mem = llmPrompt.memories;
  if (mem?.totalCount) {
    parts.push("## Memories\n");
    parts.push(`**Total**: ${mem.totalCount} memories\n`);

    // Show top memories by category
    if (mem.byCategory) {
      const categories = Object.keys(mem.byCategory);
      categories.forEach(cat => {
        const items = mem.byCategory?.[cat];
        if (items?.length) {
          parts.push(`**${cat}**:`);
          items.slice(0, 3).forEach(m => {
            parts.push(`- ${m.key}: ${m.value}`);
          });
        }
      });
    }
    parts.push("");
  }

  // Personality (adaptation)
  const pers = llmPrompt.personality;
  if (pers?.traits) {
    parts.push("## Personality Adaptation\n");
    const traits = Object.entries(pers.traits);
    traits.forEach(([name, trait]) => {
      parts.push(`- **${name}**: ${trait.level} (${pct(trait.score)})${trait.description ? ` - ${trait.description}` : ""}`);
    });

    // Personality adaptation instructions
    const adapt = llmPrompt.instructions?.personality_adaptation;
    if (adapt?.length) {
      parts.push("\n**Adaptations**:");
      adapt.forEach(a => parts.push(`- ${a}`));
    }
    parts.push("");
  }

  // Learner Goals
  const goals = llmPrompt.learnerGoals?.goals;
  if (goals?.length) {
    parts.push("## Learner Goals\n");
    goals.forEach(g => {
      const progress = g.progress !== undefined ? ` (${pct(g.progress)})` : "";
      parts.push(`- **${g.name}**${progress}${g.description ? `: ${g.description}` : ""}`);
    });
    parts.push("");
  }

  // Voice Rules (critical for real-time)
  const voice = llmPrompt.instructions?.voice;
  if (voice) {
    parts.push("## Voice Rules\n");
    if (voice.response_length) {
      parts.push(`**Response**: ${voice.response_length.target}, max ${voice.response_length.max_seconds}s`);
      if (voice.response_length.rule) parts.push(`  - ${voice.response_length.rule}`);
    }
    if (voice.natural_speech?.use_fillers) {
      parts.push(`**Fillers**: ${voice.natural_speech.use_fillers.join(", ")}`);
    }
    if (voice.natural_speech?.confirmations) {
      parts.push(`**Check-ins**: ${voice.natural_speech.confirmations.join(", ")}`);
    }
    parts.push("");
  }

  // Critical Rules (from preamble)
  const critical = llmPrompt._preamble?.criticalRules;
  if (critical?.length) {
    parts.push("## Critical Rules\n");
    critical.forEach(r => parts.push(`- ${r}`));
    parts.push("");
  }

  // Call History
  const history = llmPrompt.callHistory;
  if (history) {
    parts.push(`---\n*Call #${history.totalCalls || 1} with this caller*`);
  }

  return parts.join("\n");
}
