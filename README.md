# AKGEC SkillMate

AKGEC SkillMate is a responsive learner-facing chat site with a separate `/admin` workspace. It uses a small Node.js server and a JSON file for shared knowledge and website settings; it does not require a database.

## Run locally

1. Install Node.js 22.13+.
2. Install packages with `npm install`.
3. Set `ADMIN_PASSWORD` in the server process environment to exactly 9 digits, exactly 9 lowercase letters, or a passphrase of at least 16 characters. Nine-character passwords are significantly less secure; a unique 16+ character passphrase is strongly recommended. The passphrase is never stored in source code.
4. Start the server with `npm start`.
5. Open `http://localhost:3000` for the public chat or `http://localhost:3000/admin` for the admin studio.

Run `npm test` for the admin, security, persistence, PDF, and answer-retrieval integration tests.

For PowerShell, set the secret only in the current terminal before starting the server:

```powershell
$env:ADMIN_PASSWORD = Read-Host "Set a strong admin passphrase"
npm start
```

Set `NODE_ENV=production` when served exclusively over HTTPS. Set `DATA_DIR` to a persistent, private directory when the default `data` folder is unsuitable. Never expose the data directory as static website content.

## Admin workspace

- Sign-in is verified on the server; session cookies are HttpOnly and SameSite=Strict, with login throttling.
- Upload approved PDF (up to 3 MB), TXT, or Markdown documents, or paste verified text. PDF text is extracted server-side. Scanned/image-only PDFs require OCR and are rejected when no text can be extracted.
- Remove published documents when content becomes outdated.
- Customize the public brand name, welcome headline and description, and accent theme.
- Locally, content is stored in `DATA_DIR/knowledge.json`; it is excluded from source control. On Vercel, the app uses a private Vercel Blob object at `skillmate/knowledge.json` so uploaded content and ranking settings survive function restarts. This is file storage, not a database.

## How answers work

This version uses database-free, keyword-based retrieval from [foundation-faqs.json](./foundation-faqs.json), which contains 105 FAQ answers and 15 conversational examples from the supplied text, plus admin-uploaded material and a small summary of the official website. Each FAQ has a category, alternate question phrasing, searchable keywords, and a complete question-answer retrieval chunk. The nine categories are General Information, Courses & Training, Admissions & Registration, Fees & Duration, Internships & Placements, Centres of Excellence, Industrial Services, Startup Incubation, and Contact & Support. Duplicate questions are rejected during corpus preparation, and answers are cleaned of a known source artifact. All supplied claims are marked unverified; changeable or operational details are flagged for review before publication.

FAQ matching compares normalized question variants and answer terms, weights informative terms more heavily, and returns the best relevant answer; it is retrieval from provided text, not fine-tuning, embedding-based RAG, or training a generative language model. No vector database or external LLM is used. Uploaded material and FAQ answers are compared for relevance. Answers do not display document-source names; simple greetings receive a direct friendly response. The homepage selects its Good morning, Good afternoon, or Good evening welcome using the visitor's local time. Learners can optionally enable anonymous thumbs-up/down feedback; ratings update a small server-side contextual-bandit ranker that ranks retrieved results. This is lightweight feedback-based ranking, not full reinforcement learning. Feedback is associated with a short-lived, opaque answer token and ranking features, not the question, answer, identity, or IP address. Verify user-provided FAQ claims and update changeable information such as fees, batches, recognition, and availability with the Foundation before relying on them.

Basic safety filters reject obvious requests for credentials and explicit adult content. Phrase matching is not a robust production safety boundary; before public launch, add a reviewed moderation layer and test bypasses. Upload only material approved for public learner access. Never put passwords, student records, private data, or confidential documents in the knowledge base.

Chat history remains in each visitor's browser `localStorage`; questions are sent to this server to search the built-in Foundation summary and shared uploaded knowledge base. The built-in summary is based on the public homepage at [akgecskills.in](https://www.akgecskills.in/); admins should verify and update information that can change, such as contact details and program availability.

## Deployment

For Vercel, create and connect a **private** Blob store to the project, then set `ADMIN_PASSWORD` in Vercel Project Settings → Environment Variables. The app accepts exactly 9 digits, exactly 9 lowercase letters, or a passphrase of at least 16 characters. Nine-character passwords are significantly less secure; a unique 16+ character passphrase is strongly recommended. Never put secrets in source control or chat. The private Blob store adds its own credentials to the selected deployment environments. Until `ADMIN_PASSWORD` is configured, the public chat can be viewed but admin sign-in is deliberately disabled. Redeploy after configuring the passphrase. Point the QR code to the deployed public URL; keep `/admin` private and do not print admin credentials in a QR code.
