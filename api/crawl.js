import { crawl } from "./lib/handlers.js";

export const config = { maxDuration: 60 };

export default function handler(req, res) {
  return crawl(req, res);
}
