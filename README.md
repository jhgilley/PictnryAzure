# Sketch Sprint

A React + Vite frontend for a 2–8 player drawing party game. Every drawing round lasts 120 seconds. The first correct guess earns 2 points and the drawer earns 1 point.

## Run the frontend

```powershell
npm install
npm run dev
```

Open the shown local address. Add `?demo=true` to preview the drawing experience without a backend.

## Server-authoritative integration

This frontend intentionally does not determine words, turns, timers, scores, or valid guesses. Set `VITE_GAME_SERVER_URL` to the HTTPS address of the Node.js / Express / Socket.IO service; the client will then connect over WebSocket and emit room joins and guesses.

The backend should return a complete `room:state` snapshot after every game transition and own these decisions:

- assigning secret words and drawers
- starting and expiring the 120-second timer
- accepting or rejecting guesses
- scoring the guesser and drawer
- advancing the turn and ending the game

For Azure, deploy this static Vite build to Azure Static Web Apps (or another static host) and deploy the Socket.IO service separately to Azure App Service or an Azure VM. Configure the backend's allowed origin to the frontend URL.
