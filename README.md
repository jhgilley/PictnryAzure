# PictnryAzure — Sketch Sprint

Pictionary hosted in Azure for a contest. Sketch Sprint is a React + Vite frontend for a 2–8 player drawing party game. Every drawing round lasts 120 seconds. The first correct guess earns 2 points and the drawer earns 1 point.

## Run the frontend

```powershell
npm install
npm run dev
```

Open the shown local address. Add `?demo=true` to preview the drawing experience without a backend.

## Architecture

- **Frontend:** React + Vite, deployed independently to **Azure Static Web Apps**.
- **Backend:** Plain JavaScript **Node.js + Express + Socket.IO**, deployed to **Azure App Service**.
- **State authority:** the backend alone owns room membership, words, turns, 120-second timers, valid guesses, scores, and game completion.

## Server-authoritative integration

This frontend intentionally does not determine words, turns, timers, scores, or valid guesses. Set `VITE_GAME_SERVER_URL` to the HTTPS address of the Node.js / Express / Socket.IO service; the client will then connect over WebSocket and emit room joins and guesses.

The backend should return a complete `room:state` snapshot after every game transition and own these decisions:

- assigning secret words and drawers
- starting and expiring the 120-second timer
- accepting or rejecting guesses
- scoring the guesser and drawer
- advancing the turn and ending the game

For Azure, deploy this static Vite build to Azure Static Web Apps. Deploy the `server` directory as a separate Azure App Service running Node.js. Configure `FRONTEND_ORIGIN` on App Service to the Azure Static Web Apps URL, and `VITE_GAME_SERVER_URL` in the Static Web Apps build environment to the App Service HTTPS URL.

### Run the server locally

```powershell
cd server
npm install
npm run dev
```

Copy `server/.env.example` to `server/.env`, then leave its frontend origin set to `http://localhost:5173`. The server health endpoint is available at `http://localhost:8080/health`.
