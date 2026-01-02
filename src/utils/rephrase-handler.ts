import { LLMAgent, ChatEntry } from "../agent/llm-agent.js";
import { getTextContent } from "./content-utils.js";

export interface RephraseHandlerResult {
  updatedChatHistory: ChatEntry[];
  preFillPrompt?: string;
  cancelled: boolean;
}

/**
 * Shared rephrase handler logic for both no-ink and Ink modes.
 * Processes the user's menu choice and returns the updated chat history.
 */
export function handleRephraseChoice(
  choice: string,
  agent: LLMAgent
): RephraseHandlerResult {
  const rephraseState = agent.getRephraseState();
  if (!rephraseState) {
    return { updatedChatHistory: agent.getChatHistory(), cancelled: true };
  }

  const chatHistory = agent.getChatHistory();
  const {
    originalAssistantMessageIndex,
    rephraseRequestIndex,
    newResponseIndex,
    messageType,
  } = rephraseState;

  let updatedHistory = [...chatHistory];
  let preFillPrompt: string | undefined;
  let cancelled = false;

  switch (choice) {
    case "1": // Keep both messages
      agent.clearRephraseState();
      break;

    case "2": // Replace original with new response
      {
        // Get the rephrase command text before splicing
        const rephraseCommand = updatedHistory[rephraseRequestIndex].content || "";

        // Remove original assistant message
        updatedHistory.splice(originalAssistantMessageIndex, 1);

        // Adjust indices after removal (newResponseIndex shifts down by 1)
        const adjustedRephraseRequestIndex = rephraseRequestIndex - 1;
        const adjustedNewResponseIndex = newResponseIndex - 1;

        // Add metadata note to the rephrase request message
        if (!updatedHistory[adjustedRephraseRequestIndex].metadata) {
          updatedHistory[adjustedRephraseRequestIndex].metadata = {};
        }
        updatedHistory[adjustedRephraseRequestIndex].metadata!.rephrased_note =
          `Response replaced via: ${rephraseCommand}`;

        agent.setChatHistory(updatedHistory);
        agent.clearRephraseState();
      }
      break;

    case "3": // Try again - remove both, pre-fill prompt
      {
        const rephraseCommand = getTextContent(updatedHistory[rephraseRequestIndex].content);
        preFillPrompt = rephraseCommand;

        // Remove new response first (higher index), then rephrase request
        updatedHistory.splice(newResponseIndex, 1);
        updatedHistory.splice(rephraseRequestIndex, 1);

        agent.setChatHistory(updatedHistory);
        agent.clearRephraseState();
      }
      break;

    case "4": // Toggle message type and try again
      {
        const rephraseCommand = getTextContent(updatedHistory[rephraseRequestIndex].content);
        const toggledType = messageType === "user" ? "system" : "user";

        // Construct the new command
        if (toggledType === "system") {
          // Convert user message to system message
          preFillPrompt = `/system ${rephraseCommand}`;
        } else {
          // Convert system message to user message
          // Strip "/system " prefix if it exists
          if (rephraseCommand.startsWith("/system ")) {
            preFillPrompt = rephraseCommand.substring(8);
          } else {
            preFillPrompt = rephraseCommand;
          }
        }

        // Remove new response first (higher index), then rephrase request
        updatedHistory.splice(newResponseIndex, 1);
        updatedHistory.splice(rephraseRequestIndex, 1);

        agent.setChatHistory(updatedHistory);
        agent.clearRephraseState();
      }
      break;

    case "5": // Cancel - remove both messages
      {
        // Remove new response first (higher index), then rephrase request
        updatedHistory.splice(newResponseIndex, 1);
        updatedHistory.splice(rephraseRequestIndex, 1);

        agent.setChatHistory(updatedHistory);
        agent.clearRephraseState();
        cancelled = true;
      }
      break;
  }

  return {
    updatedChatHistory: updatedHistory,
    preFillPrompt,
    cancelled,
  };
}

/**
 * Gets the menu options text based on message type
 */
export function getRephraseMenuOptions(messageType: "user" | "system"): string[] {
  const toggleType = messageType === "user" ? "system" : "user";
  return [
    "1. Keep as new response",
    "2. Replace original response",
    "3. Try again",
    `4. Resend as ${toggleType} message`,
    "5. Cancel",
  ];
}
