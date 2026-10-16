import { io } from 'socket.io-client';

/**
 * Thin transport layer for the future server-authoritative game service.
 * The server, never this module, decides the word, turn, timer, scores,
 * valid guesses, and the next game state.
 */
export function connectToGameServer(url) {
  return io(url, {
    autoConnect: false,
    transports: ['websocket'],
  });
}

export const GAME_EVENTS = {
  JOIN_ROOM: 'room:join',
  ROOM_STATE: 'room:state',
  SUBMIT_GUESS: 'guess:submit',
  DRAW_STROKE: 'draw:stroke',
  START_GAME: 'game:start',
};
