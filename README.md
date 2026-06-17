# Quest Notes Web

Static HTML/CSS/JS client for the same Quest Notes data used by the Flutter app.

## Run

Open `index.html` directly, or serve this folder with any static server.

The default API URL is:

```text
http://localhost:3000/api
```

To override it locally without rebuilding, open the browser console once and run:

```js
localStorage.setItem('questApiBaseUrl', 'https://your-project.vercel.app/api');
location.reload();
```

The web client keeps a local offline copy in `localStorage` and pushes pending changes when the API is reachable again.

## Vercel deploy

Create a Vercel project from this folder and set Environment Variables:

```text
QUEST_API_BASE_URL=https://your-api-project.vercel.app/api
```

Vercel will run:

```bash
npm run build
```

The static output is generated into `dist`.
