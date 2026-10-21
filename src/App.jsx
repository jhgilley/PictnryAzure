import { useEffect, useMemo, useRef, useState } from 'react';
import { connectToGameServer, GAME_EVENTS } from './services/gameSocket';

const demoPlayers = [
  { id: 'you', name: 'You', color: '#f7b955', score: 6, team: 'Sun', isYou: true },
  { id: 'mara', name: 'Mara', color: '#f4826f', score: 5, team: 'Moon' },
  { id: 'dev', name: 'Dev', color: '#8c75e6', score: 4, team: 'Sun' },
  { id: 'sasha', name: 'Sasha', color: '#59c7b8', score: 3, team: 'Moon' },
];

const demoMessages = [
  { player: 'Mara', text: 'pizza?', kind: 'normal' },
  { player: 'Dev', text: 'A mountain?', kind: 'normal' },
  { player: 'Sasha', text: 'roller coaster!', kind: 'correct' },
];

const playerColors = ['#f7b955', '#f4826f', '#8c75e6', '#59c7b8', '#4d86cc', '#d071a7', '#78a65a', '#875e48'];

function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function App() {
  const isDemo = new URLSearchParams(window.location.search).get('demo') === 'true';
  const [roomCode, setRoomCode] = useState(isDemo ? 'DEMO' : 'SKETCH');
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(isDemo);
  const [connected, setConnected] = useState(false);
  const [guess, setGuess] = useState('');
  const [messages, setMessages] = useState(demoMessages);
  const [brushColor, setBrushColor] = useState('#f7b955');
  const [brushSize, setBrushSize] = useState(8);
  const [timeLeft, setTimeLeft] = useState(120);
  const [isDrawing, setIsDrawing] = useState(false);
  const [serverState, setServerState] = useState(null);
  const [joinError, setJoinError] = useState('');
  const socketRef = useRef(null);
  const canvasRef = useRef(null);
  const lastPoint = useRef(null);

  const playerName = name.trim() || 'You';
  const players = useMemo(() => demoPlayers.map((player) => player.isYou ? { ...player, name: playerName } : player), [playerName]);
  const canDraw = isDemo || Boolean(serverState?.canDraw);
  const displayedTime = serverState?.timeLeft ?? timeLeft;
  const displayedPlayers = serverState?.players?.map((player, index) => ({ ...player, color: playerColors[index % playerColors.length], isYou: player.name === playerName })) || players;
  const displayedMessages = serverState?.guesses?.map((message) => ({ ...message, kind: message.correct ? 'correct' : 'normal' })) || messages;

  useEffect(() => {
    if (!isDemo) return undefined;
    const timer = window.setInterval(() => setTimeLeft((current) => current > 0 ? current - 1 : 120), 1000);
    return () => window.clearInterval(timer);
  }, [isDemo]);

  useEffect(() => () => socketRef.current?.disconnect(), []);

  const joinRoom = () => {
    if (!roomCode.trim()) return;
    setJoinError('');
    setJoined(true);

    // In production, VITE_GAME_SERVER_URL points to the Azure-hosted Node service.
    const serverUrl = import.meta.env.VITE_GAME_SERVER_URL;
    if (!serverUrl) return;

    const socket = connectToGameServer(serverUrl);
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnected(true);
      socket.emit(GAME_EVENTS.JOIN_ROOM, { roomCode: roomCode.trim().toUpperCase(), displayName: playerName }, (result) => {
        if (!result?.ok) {
          setJoinError(result?.error || 'Unable to join this room.');
          setJoined(false);
          socket.disconnect();
        }
      });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on(GAME_EVENTS.ROOM_STATE, setServerState);
    socket.on(GAME_EVENTS.DRAW_STROKE, renderRemoteStroke);
    socket.on(GAME_EVENTS.CLEAR_CANVAS, clearCanvas);
    socket.connect();
  };

  const submitGuess = (event) => {
    event.preventDefault();
    const value = guess.trim();
    if (!value) return;
    if (connected) socketRef.current?.emit(GAME_EVENTS.SUBMIT_GUESS, { guess: value });
    if (isDemo) setMessages((current) => [...current, { player: playerName, text: value, kind: 'normal' }]);
    setGuess('');
  };

  const startGame = () => {
    socketRef.current?.emit(GAME_EVENTS.START_GAME, { totalRounds: 8 });
  };

  const canvasPoint = (event) => {
    const canvas = canvasRef.current;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
    };
  };

  const paintSegment = ({ x1, y1, x2, y2, color, size }) => {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    context.strokeStyle = color;
    context.lineWidth = size;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
  };

  const renderRemoteStroke = (stroke) => paintSegment(stroke);

  const beginStroke = (event) => {
    if (!canDraw) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDrawing(true);
    lastPoint.current = canvasPoint(event);
  };

  const draw = (event) => {
    if (!isDrawing || !canDraw || !lastPoint.current) return;
    const point = canvasPoint(event);
    const stroke = { x1: lastPoint.current.x, y1: lastPoint.current.y, x2: point.x, y2: point.y, color: brushColor, size: brushSize };
    paintSegment(stroke);
    if (connected) socketRef.current?.emit(GAME_EVENTS.DRAW_STROKE, stroke);
    lastPoint.current = point;
  };

  const endStroke = () => {
    setIsDrawing(false);
    lastPoint.current = null;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    if (connected && canDraw) socketRef.current?.emit(GAME_EVENTS.CLEAR_CANVAS);
  };

  if (!joined) {
    return <Lobby roomCode={roomCode} setRoomCode={setRoomCode} name={name} setName={setName} onJoin={joinRoom} error={joinError} />;
  }

  return (
    <main className="game-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Sketch Sprint home"><span className="brand-mark">✦</span> Sketch Sprint</a>
        <div className="room-badge"><span>ROOM</span><strong>{roomCode.toUpperCase()}</strong><button aria-label="Copy room code" onClick={() => navigator.clipboard?.writeText(roomCode.toUpperCase())}>⧉</button></div>
        {isDemo && <a className="exit-demo" href={window.location.pathname}>Exit demo</a>}
        <div className={`connection ${connected ? 'online' : 'offline'}`}><i /> {connected ? 'Live room' : isDemo ? 'Demo preview' : 'Waiting for server'}</div>
      </header>

      <section className="round-banner">
        <div><span className="eyebrow">ROUND {serverState?.round ?? 3} OF {serverState?.totalRounds ?? 8}</span><h1>{canDraw ? 'You are drawing!' : serverState?.drawerName ? `${serverState.drawerName} is drawing` : 'Waiting for the round to start'}</h1>{serverState?.status === 'lobby' && serverState.isHost && <button className="start-round" onClick={startGame}>Start 8-round game</button>}</div>
        <div className="timer" aria-label={`${displayedTime} seconds remaining`}><span>◷</span> {formatTime(displayedTime)}</div>
      </section>

      <section className="game-grid">
        <aside className="panel roster-panel">
          <div className="panel-heading"><h2>Players <span>{displayedPlayers.length}/8</span></h2><button className="icon-button" aria-label="Game settings">⚙</button></div>
          {serverState ? displayedPlayers.map((player) => <Player key={player.id} player={player} />) : <><div className="team-label"><i className="sun-dot" /> Sun Team <strong>10</strong></div>{displayedPlayers.filter((player) => player.team === 'Sun').map((player) => <Player key={player.id} player={player} />)}<div className="team-label moon"><i /> Moon Team <strong>8</strong></div>{displayedPlayers.filter((player) => player.team === 'Moon').map((player) => <Player key={player.id} player={player} />)}</>}
          <div className="round-rules"><span>✎</span><p><strong>Sketch it out!</strong><br />No letters, numbers, or words.</p></div>
        </aside>

        <section className="canvas-column">
          <div className="secret-card"><span>YOUR WORD</span><strong>{isDemo ? 'Roller Coaster' : serverState?.word || 'Hidden until the server assigns a turn'}</strong><small>{isDemo ? '2 words • Medium' : serverState?.wordHint || 'The server controls secret words.'}</small></div>
          <div className="canvas-wrap">
            <canvas ref={canvasRef} width="1000" height="650" onPointerDown={beginStroke} onPointerMove={draw} onPointerUp={endStroke} onPointerLeave={endStroke} aria-label="Drawing canvas" />
            {!isDemo && !serverState && <div className="canvas-empty"><span>✦</span><strong>Your game canvas will appear here</strong><p>Connect the Socket.IO service or open with <code>?demo=true</code> to preview the drawing experience.</p></div>}
          </div>
          <div className="toolbar">
            <div className="color-tools" aria-label="Brush color">{['#f7b955', '#f4826f', '#8c75e6', '#59c7b8', '#252336'].map((color) => <button key={color} className={brushColor === color ? 'selected' : ''} style={{ '--swatch': color }} onClick={() => setBrushColor(color)} aria-label={`Use ${color} brush`} />)}</div>
            <input aria-label="Brush size" type="range" min="3" max="24" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} />
            <button className="tool-action" onClick={clearCanvas} disabled={!canDraw}>Clear</button>
          </div>
        </section>

        <aside className="panel guesses-panel">
          <div className="panel-heading"><h2>Guesses</h2><span className="pulse"><i /> LIVE</span></div>
          <div className="guess-list">{displayedMessages.map((message, index) => <div className={`guess ${message.kind}`} key={`${message.player}-${index}`}><span>{message.player}</span>{message.kind === 'correct' && <b>✓ CORRECT!</b>}<p>{message.text}</p></div>)}</div>
          <form className="guess-form" onSubmit={submitGuess}><input value={guess} onChange={(event) => setGuess(event.target.value)} placeholder="Type your guess..." disabled={!isDemo && !connected} /><button aria-label="Send guess" disabled={!isDemo && !connected}>➜</button></form>
          <p className="guess-note">First correct answer earns 2 points. The drawer earns 1.</p>
        </aside>
      </section>
    </main>
  );
}

function Lobby({ roomCode, setRoomCode, name, setName, onJoin, error }) {
  const openDemo = () => {
    window.location.assign(`${window.location.pathname}?demo=true`);
  };

  return <main className="lobby"><section className="lobby-card"><div className="hero-mark">✦</div><p className="eyebrow">A PARTY DRAWING GAME</p><h1>Ready, set,<br /><em>sketch.</em></h1><p className="lobby-copy">Draw the clue. Race to guess. Score the most before the final round.</p><label>YOUR NAME<input maxLength="20" value={name} onChange={(event) => setName(event.target.value)} placeholder="What should we call you?" autoFocus /></label><label>ROOM CODE<input maxLength="8" value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} /></label>{error && <p className="join-error" role="alert">{error}</p>}<button className="primary-button" onClick={onJoin}>Join room <span>→</span></button><button className="demo-button" onClick={openDemo}>Try the drawing demo <span>✦</span></button><p className="lobby-footnote">Up to 4 active rooms · 2–8 players each · 120 seconds per sketch</p></section><div className="lobby-art"><div className="sketch-card"><span>GUESS THIS</span><div className="doodle">☼<br /><i>⌁</i></div><strong>Sunset</strong></div></div></main>;
}

function Player({ player }) {
  return <div className={`player ${player.isYou ? 'you' : ''}`}><span className="avatar" style={{ background: player.color }}>{player.name.slice(0, 1).toUpperCase()}</span><span>{player.name}{player.isYou && <small>YOU</small>}</span><strong>{player.score}</strong></div>;
}

export default App;
