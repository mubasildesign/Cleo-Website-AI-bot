import { testAi } from "./lib/handlers.js";

export const config = { maxDuration: 30 };

export default function handler(req, res) {
  return testAi(req, res);
}
