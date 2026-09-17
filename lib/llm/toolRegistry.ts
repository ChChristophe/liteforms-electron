import { evaluate } from "@/lib/math/expressionParser";
import type { TimerManager } from "@/lib/timer";
import { TOOL_DEFINITIONS, TOOL_INSTRUCTIONS, type ToolDefinition } from "./toolCatalogue";

export type ToolRegistry = {
  definitions: ToolDefinition[];
  instructions: string;
  execute(name: string, rawArgs: string): Promise<string>;
};

export type ToolRegistryDeps = {
  timerManager: TimerManager;
  /** Injectable clock; tests pin it to make time/date output deterministic. */
  now?: () => Date;
};

/**
 * Builds the provider-agnostic tool registry: one catalogue, one executor.
 * Every string returned by `execute` is what the model receives as the tool
 * output, so the formats mirror the web reference verbatim.
 *
 * `openclaw_web_search` will be added here (with its route and server-side
 * token) once that capability lands.
 */
export function createToolRegistry({ timerManager, now = () => new Date() }: ToolRegistryDeps): ToolRegistry {
  const execute = async (name: string, rawArgs: string): Promise<string> => {
    try {
      switch (name) {
        case "get_current_time": {
          const time = now().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false });
          return `Il est ${time}.`;
        }
        case "get_current_date": {
          const current = now();
          const day = current.toLocaleDateString("fr-FR", { weekday: "long" });
          const date = current.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
          return `On est ${day.charAt(0).toUpperCase() + day.slice(1)} ${date}.`;
        }
        case "calculate": {
          const parsed = JSON.parse(rawArgs) as { expression?: unknown };
          if (typeof parsed.expression !== "string") return "Error executing function";
          try {
            return `Le résultat est ${evaluate(parsed.expression)}.`;
          } catch (error) {
            // The parser messages ("Division par zéro", "Expression vide", ...) reach the model as-is.
            return error instanceof Error ? error.message : "Error executing function";
          }
        }
        case "start_timer": {
          const parsed = JSON.parse(rawArgs) as { duration_minutes?: number; label?: string };
          const result = timerManager.createTimer({
            durationMs: (parsed.duration_minutes ?? 1) * 60_000,
            label: parsed.label
          });
          return JSON.stringify(result);
        }
        case "get_timer_status": {
          const parsed = JSON.parse(rawArgs) as { timer_id?: string };
          return JSON.stringify(timerManager.getTimerStatus(parsed.timer_id));
        }
        case "cancel_timer": {
          const parsed = JSON.parse(rawArgs) as { timer_id?: string };
          return JSON.stringify(timerManager.cancelTimer(parsed.timer_id));
        }
        case "list_timers":
          return JSON.stringify(timerManager.listTimers());
        default:
          return `Unknown function: ${name}`;
      }
    } catch {
      // The transport must never break: unreadable JSON or an unexpected failure
      // becomes the same generic string the web reference sent to the model.
      return "Error executing function";
    }
  };

  return { definitions: TOOL_DEFINITIONS, instructions: TOOL_INSTRUCTIONS, execute };
}
