/**
 * Provider-agnostic function-calling catalogue shared by every realtime voice
 * adapter. The web POC duplicated the same definitions and instructions per
 * provider (openAiRealtime.ts / googleLive.ts); Electron keeps a single source
 * of truth and each adapter maps it to its own wire format.
 *
 * `openclaw_web_search` is served by the local `POST
 * /api/functions/openclaw_web_search` route, which resolves the OpenClaw
 * gateway token server-side (durable credential store) and never echoes it.
 */

export type JsonSchemaType = "object" | "string" | "number" | "boolean" | "array";

export type ToolParameterSchema = {
  type: JsonSchemaType;
  description?: string;
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_current_time",
    description:
      "Get the current time. Always call this function when the user asks about time, hour, or any temporal information. Never answer time questions from memory.",
    parameters: { type: "object", properties: {}, required: [] }
  },
  {
    name: "get_current_date",
    description:
      "Get the current day and date. Always call this function when the user asks about the day (lundi, mardi...), the date, or what day it is. Never answer date questions from memory.",
    parameters: { type: "object", properties: {}, required: [] }
  },
  {
    name: "openclaw_web_search",
    description:
      "Search the internet for real-time information. Always call this function when the user asks about weather, news, current events, public figures, prices, sports results, or any factual question requiring up-to-date data. Pass a concise search query in the same language as the user's question.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to look up on the web"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "start_timer",
    description:
      "Start a countdown timer. The user might say 'met un timer de 5 minutes' or 'timer 10 min pour les pates'. Label is optional. Returns structured data about the created timer.",
    parameters: {
      type: "object",
      properties: {
        duration_minutes: {
          type: "number",
          description: "Duration of the timer in minutes (e.g. 5, 10, 30)"
        },
        label: {
          type: "string",
          description:
            "Optional label for the timer (e.g. 'pates', 'cuisson'). If not provided, a generic label is assigned."
        }
      },
      required: ["duration_minutes"]
    }
  },
  {
    name: "get_timer_status",
    description:
      "Get the remaining time on a timer. If only one timer is active, no ID needed. If multiple, returns the most recent one or all.",
    parameters: {
      type: "object",
      properties: {
        timer_id: {
          type: "string",
          description: "Optional timer ID. If omitted and only one timer is running, returns that timer."
        }
      },
      required: []
    }
  },
  {
    name: "cancel_timer",
    description: "Cancel a running timer. If only one timer is active, no ID needed.",
    parameters: {
      type: "object",
      properties: {
        timer_id: {
          type: "string",
          description: "Optional timer ID. If omitted and only one timer is running, cancels that timer."
        }
      },
      required: []
    }
  },
  {
    name: "list_timers",
    description: "List all active and recent timers with their status and remaining time.",
    parameters: { type: "object", properties: {}, required: [] }
  },
  {
    name: "calculate",
    description:
      "Calculate a mathematical expression. Supports +, -, *, /, % (percentage), and parentheses. `%` is a postfix percentage: alone it divides by 100 (`200 * 10%` = 20); as the right operand of `+`/`-` it means a percentage of the left base (`200 + 10%` = 220, `200 - 10%` = 180). Always call this function when the user asks a math question, wants a calculation, or mentions numbers with an operation. Build the expression using standard math notation.",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description:
            "The mathematical expression to evaluate, e.g. '25 * 4 + 10', '(100 - 20) / 4' or '200 + 10%'"
        }
      },
      required: ["expression"]
    }
  }
];

export const TOOL_INSTRUCTIONS = `
You are a voice assistant with access to external tools. You MUST use these tools whenever applicable — never refuse or claim you cannot access information that a tool can provide.

RULES:
- When the user asks about time, hour, or any temporal information about the time → ALWAYS call get_current_time() first. NEVER answer from memory.
- When the user asks about the day (lundi, mardi...), the date, or what day it is → ALWAYS call get_current_date() first. NEVER answer from memory.
- When the user asks a math question or a calculation (addition, subtraction, multiplication, division, percentage) or mentions numbers with an operation → ALWAYS call calculate(expression). NEVER compute from memory.
- When the user asks about weather, news, current events, public figures, prices, sports results, or any factual question requiring real-time data → ALWAYS call openclaw_web_search(query) first. NEVER answer from memory.
- After calling a tool, relay the result to the user naturally and concisely in character.
- If you are unsure whether to use a tool, USE IT. It is always better to call a tool than to guess.

TIMERS:
- When the user asks to set a timer (e.g. "met un timer de 5 minutes", "timer 10 min", "mets un chrono de 30 secondes") → call start_timer with the duration. Include label only if the user explicitly mentioned one (e.g. "pour les pates").
- When the user asks how much time is left ("combien il reste", "c'est pas fini?", "il reste combien de temps") → call get_timer_status.
- When the user asks to cancel ("annule le timer", "stop le timer", "enleve le timer") → call cancel_timer.
- When the user asks to see all timers ("quels sont mes timers", "mes timers", "liste des timers") → call list_timers.
- If there is only one active timer, refer to it as "your timer" without asking for an ID.
- If there are multiple timers without labels, refer to them as "Timer 1", "Timer 2" etc.
- After a timer expires and you are notified, announce it naturally to the user.
- When you receive a message starting with "[System: timer expiré]", this is an automatic notification — just announce it to the user naturally (e.g. "Votre timer est terminé !"). Do NOT call any tool to check on it, the timer is already expired.
`.trim();
