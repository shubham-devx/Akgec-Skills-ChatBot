# AKGEC SkillMate

AKGEC SkillMate is a responsive, menu-driven learner guide with a separate `/admin` workspace. It uses a small Node.js server and JSON file storage; it does not require a database.

## Run locally

1. Install Node.js 22.13+.
2. Install packages with `npm install`.
3. Set `ADMIN_PASSWORD` in the server process environment to exactly 9 digits, exactly 9 lowercase letters, or a passphrase of at least 16 characters. Nine-character passwords are significantly less secure; a unique 16+ character passphrase is strongly recommended. The passphrase is never stored in source code.
4. Start the server with `npm start`.
5. Open `http://localhost:3000` for the public chat or `http://localhost:3000/admin` for the admin studio.

Run `npm test` for the admin, security, persistence, menu-navigation, and safety integration tests.

For PowerShell, set the secret only in the current terminal before starting the server:

```powershell
$env:ADMIN_PASSWORD = Read-Host "Set a strong admin passphrase"
npm start
```

Set `NODE_ENV=production` when served exclusively over HTTPS. Set `DATA_DIR` to a persistent, private directory when the default `data` folder is unsuitable. Never expose the data directory as static website content.

## Admin workspace

- Sign-in is verified on the server; session cookies are HttpOnly and SameSite=Strict, with login throttling.
- Edit the guided-menu JSON to add, change, or remove topics, replies, choices, and HTTPS links. Every choice must point to a configured menu screen.
- Customize the public brand name, welcome headline and description, and accent theme.
- Locally, menu content, website settings, and any previously saved documents are stored in `DATA_DIR/knowledge.json`; it is excluded from source control. On Vercel, the app uses a private Vercel Blob object at `skillmate/knowledge.json`. This is file storage, not a database.

## How the guided chat works

The home screen and chat use the same seven numbered topics. Visitors can choose a button or type a menu number, open training-program details, follow registration/contact links, and use Back, Main menu, or Exit. The chat is intentionally menu-only: uploaded documents and the older FAQ corpus are not searched or used to generate answers. Admins can update the menu and its sample content from the protected `/admin` workspace. Confirm changeable details such as fees, batches, eligibility, and availability with the Foundation before publishing or relying on them.

Basic safety filters reject obvious requests for credentials and explicit adult content. Phrase matching is not a robust production safety boundary; review and test moderation before a public launch.

Chat history remains in each visitor's browser `localStorage`. Menu choices are sent to the server to resolve the next configured screen; arbitrary questions do not trigger document or FAQ retrieval. The home greeting uses the visitor's local time.

## Deployment

For Vercel, create and connect a **private** Blob store to the project, then set `ADMIN_PASSWORD` in Vercel Project Settings → Environment Variables. The app accepts exactly 9 digits, exactly 9 lowercase letters, or a passphrase of at least 16 characters. Nine-character passwords are significantly less secure; a unique 16+ character passphrase is strongly recommended. Never put secrets in source control or chat. The private Blob store adds its own credentials to the selected deployment environments. Until `ADMIN_PASSWORD` is configured, the public chat can be viewed but admin sign-in is deliberately disabled. Redeploy after configuring the passphrase. Point the QR code to the deployed public URL; keep `/admin` private and do not print admin credentials in a QR code.
