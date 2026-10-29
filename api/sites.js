import { sites } from "./lib/handlers.js";

export default function handler(req, res) {
  return sites(req, res);
}