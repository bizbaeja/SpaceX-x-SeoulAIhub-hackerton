import {
  geminiStructureProvider,
} from "./gemini.js";
import {
  mockStructureProvider,
  type StructureProvider,
} from "./provider.js";

export {
  mockStructureFromNote,
  mockStructureProvider,
  detectHigh,
  type StructureInput,
  type StructureProvider,
} from "./provider.js";
export { geminiStructureProvider } from "./gemini.js";

export function getStructureProvider(): StructureProvider {
  if (process.env.GEMINI_API_KEY?.trim()) {
    return geminiStructureProvider;
  }
  return mockStructureProvider;
}
