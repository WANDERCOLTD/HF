/**
 * Course Reference → Markdown Renderer
 *
 * Converts COURSE_REFERENCE skeleton JSON into a full human-readable
 * markdown document. This is the educator-facing artifact — downloadable,
 * shareable, and stored as ContentSource.textSample.
 *
 * The structure mirrors the attached 3-session theme comprehension
 * reference document that inspired this feature.
 */

import type { CourseRefData } from "./course-ref-to-assertions";

export function renderCourseRefMarkdown(data: CourseRefData): string {
  const lines: string[] = [];
  const ov = data.courseOverview;

  // ── Title ──────────────────────────────────────────────────────────────
  const title = ov?.subject || "Course Reference";
  lines.push(`# ${title} — Course Reference`);
  lines.push("");

  // ── Course Overview ────────────────────────────────────────────────────
  if (ov) {
    lines.push("## Course Overview");
    lines.push("");
    if (ov.subject) lines.push(`**Subject:** ${ov.subject}`);
    if (ov.examContext) lines.push(`**Exam context:** ${ov.examContext}`);
    if (ov.studentAge) lines.push(`**Student profile:** ${ov.studentAge}`);
    if (ov.delivery) lines.push(`**Delivery:** ${ov.delivery}`);
    if (ov.courseLength) lines.push(`**Course length:** ${ov.courseLength}`);
    if (ov.prerequisite) lines.push(`**Prerequisites:** ${ov.prerequisite}`);
    if (ov.coreProposition) {
      lines.push("");
      lines.push(`**Core proposition:** ${ov.coreProposition}`);
    }
    if (ov.eqfLevel) lines.push(`**EQF Level:** ${ov.eqfLevel}`);
    if (ov.ectsCredits) lines.push(`**ECTS Credits:** ${ov.ectsCredits}`);
    if (ov.qualificationLevel) lines.push(`**Qualification:** ${ov.qualificationLevel}`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // ── Learning Outcomes ──────────────────────────────────────────────────
  const lo = data.learningOutcomes;
  if (lo && (lo.skillOutcomes?.length || lo.readinessOutcomes?.length)) {
    lines.push("## Learning Outcomes");
    lines.push("");
    if (lo.skillOutcomes?.length) {
      lines.push("### Skill Outcomes");
      lines.push("");
      for (const outcome of lo.skillOutcomes) {
        lines.push(`- **${outcome.id}.** ${outcome.description}`);
      }
      lines.push("");
    }
    if (lo.readinessOutcomes?.length) {
      lines.push("### Readiness Outcomes");
      lines.push("");
      for (const outcome of lo.readinessOutcomes) {
        lines.push(`- **${outcome.id}.** ${outcome.description}`);
      }
      lines.push("");
    }
    if (lo.progressIndicators) {
      lines.push(`**Progress indicators:** ${lo.progressIndicators}`);
      lines.push("");
    }
    if (lo.dublinDescriptors) {
      const dd = lo.dublinDescriptors;
      const categories = [
        { key: "knowledgeAndUnderstanding" as const, label: "Knowledge & Understanding" },
        { key: "applyingKnowledge" as const, label: "Applying Knowledge" },
        { key: "makingJudgements" as const, label: "Making Judgements" },
        { key: "communicationSkills" as const, label: "Communication Skills" },
        { key: "learningSkills" as const, label: "Learning Skills" },
      ];
      const filled = categories.filter((c) => dd[c.key]?.length);
      if (filled.length > 0) {
        lines.push("### Dublin Descriptors");
        lines.push("");
        for (const cat of filled) {
          lines.push(`**${cat.label}:**`);
          for (const item of dd[cat.key]!) {
            lines.push(`- ${item}`);
          }
          lines.push("");
        }
      }
    }
    lines.push("---");
    lines.push("");
  }

  // ── Skills Framework ───────────────────────────────────────────────────
  if (data.skillsFramework?.length) {
    lines.push("## Skills Framework");
    lines.push("");
    for (const skill of data.skillsFramework) {
      lines.push(`### ${skill.id}: ${skill.name}`);
      if (skill.description) lines.push(skill.description);
      if (skill.tiers) {
        lines.push("");
        if (skill.tiers.emerging) lines.push(`- **Emerging:** ${skill.tiers.emerging}`);
        if (skill.tiers.developing) lines.push(`- **Developing:** ${skill.tiers.developing}`);
        if (skill.tiers.secure) lines.push(`- **Secure:** ${skill.tiers.secure}`);
      }
      // #500 PR-2 — render per-band descriptors as bullets so the projection
      // parser (BAND_LINE in project-course-reference.ts) picks them back up
      // at create_course time and writes into Parameter.config.bandThresholds.
      if (skill.bands && Object.keys(skill.bands).length > 0) {
        lines.push("");
        const sortedBands = Object.entries(skill.bands)
          .map(([k, v]) => [Number(k), v] as const)
          .sort((a, b) => b[0] - a[0]);
        for (const [bandNum, descriptor] of sortedBands) {
          lines.push(`- **Band ${bandNum}:** ${descriptor}`);
        }
      }
      lines.push("");
    }
    if (data.skillDependencies?.length) {
      lines.push("### Skill Dependencies");
      lines.push("");
      for (const dep of data.skillDependencies) {
        lines.push(`- ${dep}`);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  // ── Teaching Approach ──────────────────────────────────────────────────
  const ta = data.teachingApproach;
  if (ta) {
    lines.push("## Teaching Approach");
    lines.push("");
    if (ta.corePrinciples?.length) {
      lines.push("### Core Principles");
      lines.push("");
      for (const p of ta.corePrinciples) {
        lines.push(`- ${p}`);
      }
      lines.push("");
    }
    if (ta.sessionStructure?.phases?.length) {
      lines.push("### Session Structure");
      lines.push("");
      lines.push("| Phase | Duration | Description |");
      lines.push("|-------|----------|-------------|");
      for (const phase of ta.sessionStructure.phases) {
        lines.push(`| ${phase.name} | ${phase.duration || "—"} | ${phase.description || "—"} |`);
      }
      lines.push("");
    }
    if (ta.techniquesBySkill?.length) {
      lines.push("### Techniques by Skill");
      lines.push("");
      for (const tech of ta.techniquesBySkill) {
        if (!tech.technique) continue;
        const label = tech.skillId ? `**${tech.skillId}:** ` : "";
        lines.push(`- ${label}${tech.technique}`);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  // ── Course Phases ──────────────────────────────────────────────────────
  if (data.coursePhases?.length) {
    lines.push("## Course Phases");
    lines.push("");
    for (const phase of data.coursePhases) {
      lines.push(`### ${phase.name}`);
      if (phase.sessions) lines.push(`**Sessions:** ${phase.sessions}`);
      if (phase.goal) lines.push(`**Goal:** ${phase.goal}`);
      lines.push("");
      if (phase.tutorBehaviour?.length) {
        lines.push("**Tutor behaviour:**");
        for (const b of phase.tutorBehaviour) lines.push(`- ${b}`);
        lines.push("");
      }
      if (phase.skillFocusPerSession?.length) {
        lines.push("**Skill focus:** " + phase.skillFocusPerSession.join(", "));
        lines.push("");
      }
      if (phase.exitCriteria?.length) {
        lines.push("**Exit criteria:**");
        for (const c of phase.exitCriteria) lines.push(`- ${c}`);
        lines.push("");
      }
    }
    lines.push("---");
    lines.push("");
  }

  // ── Module Descriptors (Bologna) ──────────────────────────────────────
  if (data.moduleDescriptors?.length) {
    lines.push("## Module Descriptors");
    lines.push("");
    for (const mod of data.moduleDescriptors) {
      lines.push(`### ${mod.id}: ${mod.title}`);
      if (mod.ectsCredits) lines.push(`**ECTS:** ${mod.ectsCredits}`);
      if (mod.assessmentMethod) lines.push(`**Assessment:** ${mod.assessmentMethod}`);
      if (mod.prerequisites?.length) lines.push(`**Prerequisites:** ${mod.prerequisites.join(", ")}`);
      if (mod.learningOutcomes?.length) {
        lines.push("**Learning Outcomes:**");
        for (const lo of mod.learningOutcomes) lines.push(`- ${lo}`);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  // ── Edge Cases ─────────────────────────────────────────────────────────
  if (data.edgeCases?.length) {
    lines.push("## Edge Cases and Recovery");
    lines.push("");
    for (const ec of data.edgeCases) {
      lines.push(`**${ec.scenario}.**`);
      lines.push(ec.response);
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  // ── Communication Rules ────────────────────────────────────────────────
  const comm = data.communicationRules;
  if (comm && (comm.toStudent?.tone || comm.toParent?.tone)) {
    lines.push("## Communication Rules");
    lines.push("");
    if (comm.toStudent) {
      lines.push("### To the Student");
      if (comm.toStudent.tone) lines.push(`**Tone:** ${comm.toStudent.tone}`);
      if (comm.toStudent.frequency) lines.push(`**Frequency:** ${comm.toStudent.frequency}`);
      lines.push("");
    }
    if (comm.toParent) {
      lines.push("### To the Parent");
      if (comm.toParent.tone) lines.push(`**Tone:** ${comm.toParent.tone}`);
      if (comm.toParent.frequency) lines.push(`**Frequency:** ${comm.toParent.frequency}`);
      if (comm.toParent.contentFormula) lines.push(`**Content formula:** ${comm.toParent.contentFormula}`);
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  // ── Assessment Boundaries ──────────────────────────────────────────────
  if (data.assessmentBoundaries?.length) {
    lines.push("## Assessment Boundaries");
    lines.push("");
    for (const b of data.assessmentBoundaries) {
      lines.push(`- ${b}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // ── Metrics ────────────────────────────────────────────────────────────
  if (data.metrics?.length) {
    lines.push("## Quality Metrics");
    lines.push("");
    for (const m of data.metrics) {
      lines.push(`- ${m}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // ── Footer ─────────────────────────────────────────────────────────────
  lines.push(`*Generated by HumanFirst Course Reference Builder — ${new Date().toISOString().split("T")[0]}*`);
  lines.push("");

  return lines.join("\n");
}
