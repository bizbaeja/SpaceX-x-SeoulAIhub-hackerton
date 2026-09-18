import "dotenv/config";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

app.listen(port, () => {
  const ai = process.env.GEMINI_API_KEY?.trim() ? "gemini" : "mock";
  console.log(`MVP API listening on http://localhost:${port} (structure=${ai})`);
});
