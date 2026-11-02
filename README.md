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

This version uses lightweight keyword retrieval over approved uploaded material and returns matching passages without displaying document sources in the public answer. Learners can optionally enable anonymous thumbs-up/down feedback; ratings update a small server-side contextual-bandit ranker that orders retrieved passages. Feedback is associated with a short-lived, opaque answer token and ranking features, not the question, answer, identity, or IP address. This is limited feedback-driven retrieval ranking—not RLHF, fine-tuning, or training a conversational language model. A protected language-model endpoint and retrieval pipeline would be needed for generated answers.

Basic safety filters reject obvious requests for credentials and explicit adult content. Phrase matching is not a robust production safety boundary; before public launch, add a reviewed moderation layer and test bypasses. Upload only material approved for public learner access. Never put passwords, student records, private data, or confidential documents in the knowledge base.

Chat history remains in each visitor's browser `localStorage`; questions are sent to this server to search the shared knowledge base. No external website content is preloaded. The supplied `skills.ac.in` host could not be reached in the authoring environment, and search results were not reliable enough to seed. Admins should add verified, approved Foundation material.

## Deployment

For Vercel, create and connect a **private** Blob store to the project, then set `ADMIN_PASSWORD` in Vercel Project Settings → Environment Variables. The app accepts exactly 9 digits, exactly 9 lowercase letters, or a passphrase of at least 16 characters. Nine-character passwords are significantly less secure; a unique 16+ character passphrase is strongly recommended. Never put secrets in source control or chat. The private Blob store adds its own credentials to the selected deployment environments. Until `ADMIN_PASSWORD` is configured, the public chat can be viewed but admin sign-in is deliberately disabled. Redeploy after configuring the passphrase. Point the QR code to the deployed public URL; keep `/admin` private and do not print admin credentials in a QR code.
