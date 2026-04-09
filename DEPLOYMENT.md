# Deployment Guide: Railway & GitHub Pages

To make RPS Clash playable across devices for everyone, we use a hybrid deployment strategy:
- **Backend (Server & Multiplayer Logic):** Hosted on [Railway](https://railway.app/).
- **Frontend (UI & Game Client):** Hosted on [GitHub Pages](https://pages.github.com/).

## 1. Deploying the Backend to Railway
1. **Push to GitHub**: Commit all your current files and push them to a repository on GitHub.
2. **Create Railway Project**:
   - Go to [Railway.app](https://railway.app/) and log in (you can sign in with your GitHub account).
   - Click **New Project** -> **Deploy from GitHub repo**.
   - Select your RPS Clash repository.
3. **Configure Environment**:
   - Railway will automatically detect the `package.json` and deploy it using Node.js.
   - Go to the **Variables** tab in your Railway service settings and add any needed environment variables (we don't strictly require any right now, but `PORT` is automatically injected by Railway).
4. **Generate Public URL**:
   - Go to the **Settings** tab of your Railway service.
   - Under **Networking**, click **Generate Domain** (or set up a custom domain). 
   - **Copy this generated URL** (e.g., `https://rps-clash-production.up.railway.app`).

## 2. Deploying the Frontend to GitHub Pages
1. **Connect the Client to the Server**:
   - Open `docs/game.js` in your code editor.
   - Look for the `BACKEND_URL` variable at the very top.
   - Change it so that in production, it points to your new Railway URL:
     ```javascript
     const BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
       ? `http://${window.location.hostname}:3000` 
       : 'https://rps-clash-production.up.railway.app'; // <--- PASTE YOUR RAILWAY URL HERE
     ```
2. **Setup Google Login (Optional but Recommended)**:
   - Go to the [Google Cloud Console](https://console.cloud.google.com/).
   - Create a new Project (or use an existing one).
   - Navigate to **APIs & Services > Credentials**.
   - Create a **Web Application OAuth 2.0 Client ID**.
   - Add your domains to the "Authorized JavaScript origins":
     - `http://localhost:3000`
     - `https://<your-username>.github.io`
   - Copy the generated **Client ID**.
   - Open `docs/index.html`, find the `<div id="g_id_onload"...` element, and replace `<YOUR_GOOGLE_CLIENT_ID>` with your real Client ID.
3. **Push Changes**:
   - Commit the changes to `docs/game.js` and `docs/index.html` and push them to GitHub.
4. **Enable GitHub Pages**:
   - Go to your repository settings on GitHub.
   - On the left sidebar, click **Pages**.
   - Under **Build and deployment**, set the **Source** to **Deploy from a branch**.
   - Select the `main` (or `master`) branch, and set the folder dropdown to `/docs`.
   - Click **Save**.
5. **Play!**
   - GitHub will provide a URL (e.g., `https://<your-username>.github.io/rps-game/`).
   - Give this URL to your friends, and everyone can play together using the Railway server backend.
