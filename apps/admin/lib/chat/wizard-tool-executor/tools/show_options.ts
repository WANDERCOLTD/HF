import type { WizardToolExec } from "../_shared/types";

export async function execute(): Promise<WizardToolExec> {
  return { content: `Panel displayed to user. Wait for their response.` };
}
