# Cleo

Cleo is an open source website assistant. You add a site you own, paste your own AI key, and embed one script. Cleo reads the public pages on that site, including the blog and FAQs, and answers visitors in the role you choose.

The embed never contains the API key. The key stays on the Cleo server.

## What you can set up

- **Who answers.** Site guide, sales rep, help desk, founder, product expert, concierge, recruiter, or a custom role. Tone, reply length, language, and extra instructions are all editable.
- **Knowledge.** Cleo reads the sitemap, follows links on the same domain, and keeps the pages it finds. You can add notes that are not on the site, such as policies or pricing clarifications.
- **Model.** Bring an OpenAI-compatible key. Presets cover OpenAI, Google Gemini, Anthropic, Groq, OpenRouter, Mistral, and any custom base URL. A pasted key is matched to a provider automatically.
- **Widget.** Name, greeting, suggestions, color, theme, position, launcher, and an optional nudge. The dashboard shows a live preview.
- **Install.** One script tag for a plain HTML site, Webflow, WordPress, or Shopify.

## How a reply is made

1. The visitor asks a question on your domain.
2. The widget sends the question, recent turns, and the page they are on.
3. The server checks the public site key and that the request came from the domain you added.
4. Cleo searches the indexed pages and your notes, then calls your model.
5. The answer streams back. Sources can be shown as links to your pages.

If the key is missing or the model fails, the widget says it cannot answer right now.

## Local setup

You need Node.js 20 or newer.

```bash
git clone <this-repository>
cd <this-repository>
npm install
cp .env.example .env.local
npm run dev
```

Open the URL Vite prints, usually `http://127.0.0.1:5174` or `http://localhost:5173`.

Sign in with the local password `axon` until you set `ADMIN_PASSWORD` in `.env.local`. Restart `npm run dev` after changing env values.

Then, in the dashboard:

1. Add a site by domain, for example `example.com`.
2. Open **Knowledge** and read the site. Pages, FAQs, and blog posts show up in the list.
3. Open **AI model**, paste your key, and run **Test connection**.
4. Choose a persona and adjust the widget.
5. Save, then copy the snippet from **Install**.

Sites and indexed pages are stored in `.data/` on your machine. That folder is gitignored. Do not commit it. It holds your API key.

`npm run dev` and `npm run build` copy the widget into `public/widget/` before they start. That folder is generated. Do not commit it.

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `ADMIN_PASSWORD` | On any shared deploy | Password for the dashboard. Locally, unset means `axon`. On Vercel, unset means nobody can sign in. |
| `KV_REST_API_URL` | On Vercel | Upstash or Vercel KV REST URL. Stores sites when the filesystem is not durable. |
| `KV_REST_API_TOKEN` | On Vercel | Token for that KV database. |

Local development does not need KV. Copy `.env.example` to `.env.local` and fill in what you use.

## Install snippet

```html
<script
  src="https://YOUR-VERCEL-DOMAIN/widget/loader.js"
  data-site-key="PUBLIC_SITE_KEY"
  defer>
</script>
```

`PUBLIC_SITE_KEY` identifies the site. It is safe to put in the page. Your model key is not in this snippet.

The widget only runs on the domain you saved, and on `www` of that domain. The dashboard preview is allowed while you are signed in.

If you test an HTTPS site against Cleo on your computer, Chrome may ask to allow local network access. Allow it for that test. Deploy Cleo before you install it on a live site.

## Deploy on Vercel

1. Push this repo to GitHub, GitLab, or another host Vercel can import.
2. Import the project in Vercel. The framework is Vite. `vercel.json` already sets function timeouts and the SPA rewrite.
3. Set `ADMIN_PASSWORD` to a long password.
4. Create a Vercel KV or Upstash Redis database and add `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Without them, production cannot save sites.
5. Deploy.

The server routes are in `api/`. Chat, crawl, and the model test need the longer timeouts already set in `vercel.json`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dashboard and API on your machine |
| `npm run build` | Production build of the dashboard and widget |
| `npm run preview` | Serves the production build locally |
| `npm run lint` | ESLint |
| `npm run typecheck` | Typecheck against `jsconfig.json` |

## Project layout

| Path | What it is |
| --- | --- |
| `src/pages/Landing.jsx` | Public homepage and sign-in |
| `src/pages/Console.jsx` | Dashboard |
| `src/widget.js`, `src/widget.css`, `src/loader.js` | Embeddable widget |
| `api/` | HTTP handlers used by Vercel and by the local dev server |
| `public/preview.html` | Live preview frame inside the dashboard |
| `.data/` | Local sites and knowledge. Not committed. |

## License

MIT. See [LICENSE](LICENSE).
