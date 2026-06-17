import { prisma } from "@/lib/prisma";
import { MemoryCategory } from "@prisma/client";

// #1504 Slice 3 — public chat tabs are now ASSISTANT + DEMO only. CALL +
// BUG remain in the union because they're still dispatched through this
// command pipeline by route-level entry points (voice sim, bug reporter) —
// they are never picked by a UI tab. Pre-Slice-3 aliases (DATA / TUNING /
// COURSE_MANAGE) are normalised to ASSISTANT by the route handler before
// reaching this layer, so they don't appear here.
type ChatMode = "ASSISTANT" | "CALL" | "BUG" | "DEMO";

interface EntityBreadcrumb {
  type: string;
  id: string;
  label: string;
  data?: Record<string, unknown>;
}

interface CommandContext {
  entityContext: EntityBreadcrumb[];
  mode: ChatMode;
  tuningScope?: "LEARNER" | "PLAYBOOK";
}

interface CommandResult {
  ok: boolean;
  message: string;
  data?: unknown;
  action?: "display" | "navigate" | "execute";
  navigateTo?: string;
}

interface ChatCommand {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  modes: ChatMode[];
  execute: (args: string[], ctx: CommandContext) => Promise<CommandResult>;
}

/**
 * Parse a message to see if it's a command
 */
export function parseCommand(input: string): { command: string; args: string[] } | null {
  if (!input.startsWith("/")) return null;

  const parts = input.slice(1).trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || "";
  const args = parts.slice(1);

  return { command, args };
}

/**
 * Find a command by name or alias
 */
function findCommand(commandName: string): ChatCommand | undefined {
  return COMMANDS.find((c) => c.name === commandName || c.aliases.includes(commandName));
}

/**
 * Execute a command
 */
export async function executeCommand(
  input: string,
  entityContext: EntityBreadcrumb[],
  mode: ChatMode,
  tuningScope?: "LEARNER" | "PLAYBOOK"
): Promise<CommandResult> {
  const parsed = parseCommand(input);
  if (!parsed) {
    return { ok: false, message: "Invalid command format" };
  }

  const command = findCommand(parsed.command);
  if (!command) {
    return {
      ok: false,
      message: `Unknown command: /${parsed.command}\n\nType /help to see available commands.`,
    };
  }

  if (!command.modes.includes(mode)) {
    return {
      ok: false,
      message: `Command /${command.name} is not available in ${mode} mode.\n\nAvailable in: ${command.modes.join(", ")}`,
    };
  }

  try {
    return await command.execute(parsed.args, { entityContext, mode, tuningScope });
  } catch (error) {
    return {
      ok: false,
      message: `Error executing /${command.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

// ============================================================
// COMMAND DEFINITIONS
// ============================================================

const COMMANDS: ChatCommand[] = [
  {
    name: "help",
    aliases: ["?", "commands"],
    description: "Show available commands",
    usage: "/help [command]",
    modes: ["ASSISTANT", "CALL", "DEMO"],
    execute: async (args, ctx) => {
      const specificCommand = args[0];
      if (specificCommand) {
        const cmd = findCommand(specificCommand);
        if (cmd) {
          return {
            ok: true,
            message: `**/${cmd.name}**\n${cmd.description}\n\nUsage: \`${cmd.usage}\`\nAliases: ${cmd.aliases.length > 0 ? cmd.aliases.map((a) => `/${a}`).join(", ") : "none"}\nModes: ${cmd.modes.join(", ")}`,
            action: "display",
          };
        }
        return { ok: false, message: `Unknown command: ${specificCommand}` };
      }

      const available = COMMANDS.filter((c) => c.modes.includes(ctx.mode));
      const lines = [
        `**Available Commands in ${ctx.mode} mode:**`,
        "",
        ...available.map((c) => `• \`/${c.name}\` - ${c.description}`),
        "",
        "Type `/help <command>` for detailed usage.",
      ];

      return { ok: true, message: lines.join("\n"), action: "display" };
    },
  },

  {
    name: "context",
    aliases: ["ctx"],
    description: "Show current entity context",
    usage: "/context",
    modes: ["ASSISTANT", "CALL"],
    execute: async (args, ctx) => {
      if (ctx.entityContext.length === 0) {
        return {
          ok: true,
          message:
            "**No context selected**\n\nNavigate to a caller, call, or other entity to add context.\nThe chat will automatically be aware of selected entities.",
          action: "display",
        };
      }

      const lines = [
        "**Current Context:**",
        "",
        ...ctx.entityContext.map((e, i) => {
          const prefix = i > 0 ? "  └─ " : "";
          return `${prefix}**${e.type}:** ${e.label} (${e.id.slice(0, 8)}...)`;
        }),
      ];

      return { ok: true, message: lines.join("\n"), action: "display" };
    },
  },

  {
    name: "clear",
    aliases: ["reset"],
    description: "Clear chat history for current mode",
    usage: "/clear",
    modes: ["ASSISTANT", "CALL"],
    execute: async (args, ctx) => {
      return {
        ok: true,
        message: `Chat history cleared for ${ctx.mode} mode.`,
        action: "execute",
        data: { clearHistory: ctx.mode },
      };
    },
  },

  {
    name: "memories",
    aliases: ["mem"],
    description: "Show memories for current caller",
    usage: "/memories [category]",
    modes: ["ASSISTANT", "CALL"],
    execute: async (args, ctx) => {
      const callerEntity = ctx.entityContext.find((e) => e.type === "caller");
      if (!callerEntity) {
        return { ok: false, message: "No caller selected. Navigate to a caller first." };
      }

      const category = args[0]?.toUpperCase();
      const validCategories = Object.values(MemoryCategory);

      if (category && !(validCategories as string[]).includes(category)) {
        return {
          ok: false,
          message: `Invalid category: ${category}\n\nValid categories: ${validCategories.join(", ")}`,
        };
      }

      const memories = await prisma.callerMemory.findMany({
        where: {
          callerId: callerEntity.id,
          supersededById: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          ...(category ? { category: category as MemoryCategory } : {}),
        },
        orderBy: [{ category: "asc" }, { confidence: "desc" }],
        take: 50,
      });

      if (memories.length === 0) {
        return {
          ok: true,
          message: category
            ? `No ${category} memories found for ${callerEntity.label}.`
            : `No memories found for ${callerEntity.label}.`,
          action: "display",
        };
      }

      const grouped: Record<string, typeof memories> = {};
      for (const mem of memories) {
        if (!grouped[mem.category]) grouped[mem.category] = [];
        grouped[mem.category].push(mem);
      }

      const lines = [`**Memories for ${callerEntity.label}:**`, ""];
      for (const [cat, mems] of Object.entries(grouped)) {
        lines.push(`**${cat}** (${mems.length})`);
        for (const m of mems.slice(0, 5)) {
          const conf = (m.confidence * 100).toFixed(0);
          lines.push(`• ${m.key}: ${m.value} (${conf}%)`);
        }
        if (mems.length > 5) {
          lines.push(`  ... and ${mems.length - 5} more`);
        }
        lines.push("");
      }

      return {
        ok: true,
        message: lines.join("\n"),
        data: memories,
        action: "display",
      };
    },
  },

  {
    name: "buildprompt",
    aliases: ["prompt", "compose"],
    description: "Show or build the composed prompt for current caller",
    usage: "/buildprompt",
    modes: ["ASSISTANT", "CALL"],
    execute: async (args, ctx) => {
      const callerEntity = ctx.entityContext.find((e) => e.type === "caller");
      if (!callerEntity) {
        return { ok: false, message: "No caller selected. Navigate to a caller first." };
      }

      // Get the most recent composed prompt
      const prompt = await prisma.composedPrompt.findFirst({
        where: { callerId: callerEntity.id },
        orderBy: { composedAt: "desc" },
      });

      if (!prompt) {
        return {
          ok: true,
          message: `No composed prompt found for ${callerEntity.label}.\n\nRun "Compose Prompt" on the caller detail page to generate one.`,
          action: "display",
        };
      }

      const lines = [
        `**Composed Prompt for ${callerEntity.label}**`,
        "",
        `Composed: ${prompt.composedAt.toLocaleString()}`,
        `Trigger: ${prompt.triggerType || "manual"}`,
        "",
        "**Prompt:**",
        "```",
        prompt.prompt?.slice(0, 1500) || "(empty)",
        prompt.prompt && prompt.prompt.length > 1500 ? "... (truncated)" : "",
        "```",
      ];

      return {
        ok: true,
        message: lines.join("\n"),
        data: prompt,
        action: "display",
      };
    },
  },

  {
    name: "caller",
    aliases: [],
    description: "Show information about the current caller",
    usage: "/caller",
    modes: ["ASSISTANT", "CALL"],
    execute: async (args, ctx) => {
      const callerEntity = ctx.entityContext.find((e) => e.type === "caller");
      if (!callerEntity) {
        return { ok: false, message: "No caller selected. Navigate to a caller first." };
      }

      const caller = await prisma.caller.findUnique({
        where: { id: callerEntity.id },
        include: {
          domain: true,
          personality: true,
          _count: {
            select: {
              calls: true,
              memories: true,
            },
          },
        },
      });

      if (!caller) {
        return { ok: false, message: "Caller not found." };
      }

      const lines = [
        `**${caller.name ?? caller.id}**`,
        "",
        `• ID: ${caller.id}`,
        ...(caller.email ? [`• Email: ${caller.email}`] : []),
        ...(caller.phone ? [`• Phone: ${caller.phone}`] : []),
        ...(caller.domain?.name ? [`• Domain: ${caller.domain.name}`] : []),
        `• Total Calls: ${caller._count.calls}`,
        `• Active Memories: ${caller._count.memories}`,
      ];

      if (caller.personality) {
        const p = caller.personality;
        lines.push("", "**Personality:**");
        if (p.openness !== null) lines.push(`• Openness: ${(p.openness * 100).toFixed(0)}%`);
        if (p.conscientiousness !== null)
          lines.push(`• Conscientiousness: ${(p.conscientiousness * 100).toFixed(0)}%`);
        if (p.extraversion !== null) lines.push(`• Extraversion: ${(p.extraversion * 100).toFixed(0)}%`);
        if (p.agreeableness !== null) lines.push(`• Agreeableness: ${(p.agreeableness * 100).toFixed(0)}%`);
        if (p.neuroticism !== null) lines.push(`• Neuroticism: ${(p.neuroticism * 100).toFixed(0)}%`);
      }

      return {
        ok: true,
        message: lines.join("\n"),
        data: caller,
        action: "display",
      };
    },
  },

  {
    name: "scope",
    aliases: [],
    description: "Show current tuning scope (LEARNER or PLAYBOOK)",
    usage: "/scope",
    modes: ["ASSISTANT"],
    execute: async (_args, ctx) => {
      const scope = ctx.tuningScope ?? "PLAYBOOK";
      const explainer =
        scope === "LEARNER"
          ? "Changes apply to the selected learner only."
          : "Changes apply to the whole course.";
      // #1504 Slice 3 — the scope toggle now lives inline inside the
      // Assistant tab (no separate Tuning tab post-consolidation).
      return {
        ok: true,
        message: `**Scope: ${scope}**\n\n${explainer}\n\nFlip with the Scope toggle just above the message list in the Assistant tab.`,
        action: "display",
      };
    },
  },

  {
    name: "params",
    aliases: ["parameters"],
    description: "List tunable parameters for current context",
    usage: "/params",
    modes: ["ASSISTANT"],
    execute: async (_args, ctx) => {
      const scope = ctx.tuningScope ?? "PLAYBOOK";
      const lines = [
        `**Tunable parameters — ${scope} scope**`,
        "",
        "Full per-context parameter discovery is coming with the tuning",
        "registry. For now, ask the assistant directly:",
        "",
        "• \"Which parameters can I tune for this learner?\"",
        "• \"Show me the playbook config keys I can override.\"",
        "",
        "The assistant has tool access to the live parameter set and will",
        "return the current value plus the safe range.",
      ];
      return {
        ok: true,
        message: lines.join("\n"),
        action: "display",
      };
    },
  },

];
