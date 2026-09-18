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
  // Demo-safe: force mock even if key exists
  if (process.env.STRUCTURE_FORCE_MOCK === "1") {
    return mockStructureProvider;
  }
  if (process.env.GEMINI_API_KEY?.trim()) {
    return geminiStructureProvider;
  }
  return mockStructureProvider;
}
