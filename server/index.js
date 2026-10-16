import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const PORT = Number(process.env.PORT || 8080);
const ROUND_SECONDS = 120;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const WORDS = [
  { answer: 'roller coaster', hint: '2 words', difficulty: 'Medium' },
  { answer: 'birthday cake', hint: '2 words', difficulty: 'Easy' },
  { answer: 'shooting star', hint: '2 words', difficulty: 'Medium' },
  { answer: 'ice cream cone', hint: '3 words', difficulty: 'Easy' },
  { answer: 'volcano', hint: '1 word', difficulty: 'Medium' },
  { answer: 'treasure map', hint: '2 words', difficulty: 'Hard' },
  { answer: 'popcorn', hint: '1 word', difficulty: 'Easy' },
  { answer: 'time machine', hint: '2 words', difficulty: 'Hard' },
];

const app = express();
const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed.'));
  },
};

app.use(cors(corsOptions));
app.get('/health', (_request, response) => response.json({ status: 'ok' }));
app.get('/', (_request, response) => response.json({ service: 'PictnryAzure game server', status: 'ok' }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: corsOptions });
const rooms = new Map();

function cleanRoomCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function cleanName(value) {
  return String(value || '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 20);
}

function normalise(value) {
  return String(value || '').trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function createRoom(code, hostId) {
  return {
    code,
    hostId,
    players: [],
    round: 0,
    totalRounds: 8,
    status: 'lobby',
    drawerId: null,
    word: null,
    timeLeft: ROUND_SECONDS,
    timer: null,
    recentGuesses: [],
    usedWords: new Set(),
    winningPlayerId: null,
  };
}

function publicRoomState(room, playerId) {
  const drawer = room.players.find((player) => player.id === room.drawerId);
  return {
    code: room.code,
    hostId: room.hostId,
    isHost: room.hostId === playerId,
    status: room.status,
    round: room.round,
    totalRounds: room.totalRounds,
    timeLeft: room.timeLeft,
    drawerId: room.drawerId,
    drawerName: drawer?.name || null,
    players: room.players.map(({ id, name, score, team, connected }) => ({ id, name, score, team, connected })),
    guesses: room.recentGuesses,
    canDraw: room.status === 'drawing' && room.drawerId === playerId,
    word: room.status === 'drawing' && room.drawerId === playerId ? room.word : null,
    wordHint: room.status === 'drawing' && room.drawerId === playerId ? `${room.word.split(' ').length} word${room.word.includes(' ') ? 's' : ''}` : null,
    winningPlayerId: room.winningPlayerId,
  };
}

function emitRoomState(room) {
  for (const player of room.players) {
    io.to(player.id).emit('room:state', publicRoomState(room, player.id));
  }
}

function clearTimer(room) {
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
}

function selectWord(room) {
  const remaining = WORDS.filter((word) => !room.usedWords.has(word.answer));
  if (!remaining.length) room.usedWords.clear();
  const choice = (remaining.length ? remaining : WORDS)[Math.floor(Math.random() * (remaining.length ? remaining.length : WORDS.length))];
  room.usedWords.add(choice.answer);
  return choice.answer;
}

function finishGame(room) {
  clearTimer(room);
  room.status = 'finished';
  room.word = null;
  room.drawerId = null;
  room.timeLeft = 0;
  emitRoomState(room);
}

function finishRound(room, event) {
  if (room.status !== 'drawing') return;
  clearTimer(room);
  room.status = 'round-ended';
  room.timeLeft = 0;
  io.to(room.code).emit('round:ended', { answer: room.word, ...event });
  emitRoomState(room);

  setTimeout(() => {
    if (room.status !== 'round-ended') return;
    if (room.round >= room.totalRounds) return finishGame(room);
    startRound(room);
  }, 3500);
}

function startRound(room) {
  const activePlayers = room.players.filter((player) => player.connected);
  if (activePlayers.length < MIN_PLAYERS) {
    room.status = 'lobby';
    emitRoomState(room);
    return;
  }

  room.round += 1;
  const drawerIndex = (room.round - 1) % activePlayers.length;
  room.drawerId = activePlayers[drawerIndex].id;
  room.word = selectWord(room);
  room.status = 'drawing';
  room.timeLeft = ROUND_SECONDS;
  room.recentGuesses = [];
  room.winningPlayerId = null;
  io.to(room.code).emit('canvas:clear');
  emitRoomState(room);

  room.timer = setInterval(() => {
    room.timeLeft -= 1;
    if (room.timeLeft <= 0) {
      finishRound(room, { reason: 'time-expired' });
      return;
    }
    emitRoomState(room);
  }, 1000);
}

function roomForSocket(socket) {
  return socket.data.roomCode ? rooms.get(socket.data.roomCode) : null;
}

function leaveCurrentRoom(socket) {
  const room = roomForSocket(socket);
  if (!room) return;
  const player = room.players.find((entry) => entry.id === socket.id);
  if (player) player.connected = false;
  if (room.hostId === socket.id) room.hostId = room.players.find((entry) => entry.connected)?.id || null;
  socket.leave(room.code);
  emitRoomState(room);
  if (!room.players.some((entry) => entry.connected)) {
    clearTimer(room);
    rooms.delete(room.code);
  }
}

io.on('connection', (socket) => {
  socket.on('room:join', ({ roomCode, displayName } = {}, reply = () => {}) => {
    const code = cleanRoomCode(roomCode);
    const name = cleanName(displayName);
    if (!code || !name) return reply({ ok: false, error: 'A room code and display name are required.' });

    leaveCurrentRoom(socket);
    const room = rooms.get(code) || createRoom(code, socket.id);
    if (!rooms.has(code)) rooms.set(code, room);
    if (room.players.filter((player) => player.connected).length >= MAX_PLAYERS) return reply({ ok: false, error: 'This room is full.' });

    room.players.push({ id: socket.id, name, score: 0, team: null, connected: true });
    socket.data.roomCode = code;
    socket.join(code);
    emitRoomState(room);
    reply({ ok: true });
  });

  socket.on('game:start', ({ totalRounds = 8 } = {}, reply = () => {}) => {
    const room = roomForSocket(socket);
    if (!room) return reply({ ok: false, error: 'Join a room first.' });
    if (room.hostId !== socket.id) return reply({ ok: false, error: 'Only the host can start the game.' });
    if (room.status === 'drawing') return reply({ ok: false, error: 'A game is already underway.' });
    if (room.players.filter((player) => player.connected).length < MIN_PLAYERS) return reply({ ok: false, error: 'At least two players are needed.' });

    room.round = 0;
    room.totalRounds = Math.min(20, Math.max(1, Number(totalRounds) || 8));
    room.usedWords.clear();
    for (const player of room.players) player.score = 0;
    startRound(room);
    reply({ ok: true });
  });

  socket.on('guess:submit', ({ guess } = {}, reply = () => {}) => {
    const room = roomForSocket(socket);
    if (!room || room.status !== 'drawing') return reply({ ok: false, error: 'There is no active round.' });
    if (socket.id === room.drawerId) return reply({ ok: false, error: 'The drawer cannot guess.' });
    const value = String(guess || '').trim().slice(0, 80);
    if (!value) return reply({ ok: false, error: 'Enter a guess.' });

    const player = room.players.find((entry) => entry.id === socket.id);
    const correct = normalise(value) === normalise(room.word);
    room.recentGuesses.push({ playerId: socket.id, player: player.name, text: value, correct });
    room.recentGuesses = room.recentGuesses.slice(-30);
    if (!correct) {
      emitRoomState(room);
      return reply({ ok: true, correct: false });
    }

    const drawer = room.players.find((entry) => entry.id === room.drawerId);
    player.score += 2;
    drawer.score += 1;
    room.winningPlayerId = player.id;
    reply({ ok: true, correct: true });
    finishRound(room, { reason: 'correct-guess', winnerId: player.id, winnerName: player.name });
  });

  socket.on('draw:stroke', (stroke) => {
    const room = roomForSocket(socket);
    if (!room || room.status !== 'drawing' || room.drawerId !== socket.id) return;
    if (!stroke || !Number.isFinite(stroke.x1) || !Number.isFinite(stroke.y1) || !Number.isFinite(stroke.x2) || !Number.isFinite(stroke.y2)) return;
    socket.to(room.code).emit('draw:stroke', stroke);
  });

  socket.on('canvas:clear', () => {
    const room = roomForSocket(socket);
    if (room?.status === 'drawing' && room.drawerId === socket.id) socket.to(room.code).emit('canvas:clear');
  });

  socket.on('disconnect', () => leaveCurrentRoom(socket));
});

httpServer.listen(PORT, () => console.log(`PictnryAzure server listening on port ${PORT}`));
