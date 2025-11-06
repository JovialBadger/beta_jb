function createTurnGameEngine() {
  // =========================
  // Utilities and primitives
  // =========================
  const now = () => Date.now();

  // Fast, deterministic, dependency-free hash (FNV-1a 32-bit)
  function hashJSON(obj) {
    const str = typeof obj === "string" ? obj : JSON.stringify(obj);
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    // Return as hex string
    return ("0000000" + h.toString(16)).slice(-8);
  }

  // Deep clone helper
  function deepClone(obj) {
    return obj == null ? obj : JSON.parse(JSON.stringify(obj));
  }

  // =========================
  // Configuration
  // =========================
  const config = {
    heartbeatIntervalMs: 5000,
    idleThresholdMs: 30000,
    awayThresholdMs: 120000,
    reconnectDebounceMs: 3000,
    actionLogLimit: 256,
    connectionIceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    notifyOnTurn: true,
    useLamport: true, // if false, use per-player monotonic counters only
    crossTabKeyPrefix: "turnGameEngine:",
    sdpCacheKeyPrefix: "turnGameEngine:SDP:",
  };

  // =========================
  // Globals
  // =========================
  const games = new Map(); // gameId -> gameCtx
  let activeGameId = null;

  // BroadcastChannel for cross-tab sync (optional)
  const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(config.crossTabKeyPrefix + "bus") : null;

  // Notifications
  function notify(title, body) {
    if (!config.notifyOnTurn) return;
    try {
      if (document.hasFocus()) return;
      if ("Notification" in window) {
        if (Notification.permission === "granted") {
          new Notification(title, { body });
        } else if (Notification.permission !== "denied") {
          Notification.requestPermission().then((p) => {
            if (p === "granted") new Notification(title, { body });
          });
        }
      }
    } catch {}
  }

  // Presence helpers
  function presenceState(ctx) {
    const t = now() - ctx.lastActivityAt;
    if (!ctx.peerOnline) return "offline";
    if (t >= config.awayThresholdMs) return "away";
    if (t >= config.idleThresholdMs) return "idle";
    return "online";
  }

  // =========================
  // Default deterministic reducer
  // Replace or inject your own reducer per game
  // =========================
  // State shape suggestion:
  // {
  //   gameId,
  //   players: [idA, idB, ...],
  //   currentTurn: idA,
  //   turnNumber: 0,
  //   payload: {...domain state...},
  //   clocks: { lamport: 0, counters: { [playerId]: 0 } },
  //   lastUpdatedAt: <ms>,
  //   hash: <hex>
  // }
  function defaultReducer(state, action, localPlayerId) {
    let next = state;

    // Lamport or monotonic counter update
    function advanceClocks(nextState, actionClock) {
      const ns = deepClone(nextState);
      if (!ns.clocks) ns.clocks = { lamport: 0, counters: {} };
      const counters = ns.clocks.counters || (ns.clocks.counters = {});
      counters[localPlayerId] = (counters[localPlayerId] || 0);

      if (action.type === "MAKE_MOVE" || action.type === "SYSTEM") {
        if (config.useLamport) {
          const remoteLamport = action.meta?.lamport ?? ns.clocks.lamport;
          ns.clocks.lamport = Math.max(ns.clocks.lamport, remoteLamport) + 1;
        } else {
          const remoteCounter = action.meta?.counter ?? counters[localPlayerId];
          counters[localPlayerId] = Math.max(counters[localPlayerId], remoteCounter) + 1;
        }
      }
      return ns;
    }

    function finalize(nextState) {
      const n = deepClone(nextState);
      n.lastUpdatedAt = now();
      n.hash = hashJSON({ payload: n.payload, turnNumber: n.turnNumber, currentTurn: n.currentTurn, clocks: n.clocks });
      return n;
    }

    // Turn-locked move
    if (action.type === "MAKE_MOVE") {
      if (state.currentTurn !== localPlayerId) {
        return { state, error: "Not your turn." };
      }
      // Apply domain mutation via provided function or object
      const nextPayload =
        typeof action.apply === "function"
          ? action.apply(state.payload)
          : (action.delta ? { ...state.payload, ...action.delta } : state.payload);
      const nextTurnIdx = (state.players.indexOf(state.currentTurn) + 1) % state.players.length;

      next = {
        ...state,
        payload: nextPayload,
        turnNumber: state.turnNumber + 1,
        currentTurn: state.players[nextTurnIdx],
      };
      next = advanceClocks(next, action.meta);
      next = finalize(next);
      return { state: next, error: null };
    }

    // Accept remote snapshot
    if (action.type === "SYNC_SNAPSHOT") {
      next = deepClone(action.snapshot);
      // Trust host snapshot; re-hash locally
      next.hash = hashJSON({ payload: next.payload, turnNumber: next.turnNumber, currentTurn: next.currentTurn, clocks: next.clocks });
      return { state: next, error: null };
    }

    // System change (e.g., force turn)
    if (action.type === "SYSTEM_SET_TURN") {
      next = { ...state, currentTurn: action.playerId };
      next = advanceClocks(next, action.meta);
      next = finalize(next);
      return { state: next, error: null };
    }

    // No-op fallback
    return { state, error: null };
  }

  // =========================
  // Game context creation
  // =========================
  function createGameContext({
    gameId,
    localPlayerId,
    initialState,
    reducer = defaultReducer,
    onEvent = () => {},
    onStatus = () => {},
    onBeforeMove = () => {},
    onAfterMove = () => {},
    onPresenceChange = () => {},
    onReconnect = () => {},
    spectators = [], // array of spectator connections (DataChannels)
  }) {
    const pc = new RTCPeerConnection({ iceServers: config.connectionIceServers });
    const dc = pc.createDataChannel("game"); // primary channel for peer
    const specChannels = []; // spectator data channels (optional; same peer could host spectators)
    let remoteDescriptionSet = false;

    const ctx = {
      gameId,
      localPlayerId,
      reducer,
      onEvent,
      onStatus,
      onBeforeMove,
      onAfterMove,
      onPresenceChange,
      onReconnect,
      pc,
      dc,
      specChannels,
      connectionReady: false,
      peerOnline: false,
      lastActivityAt: now(),
      lastHeartbeatAt: 0,
      heartbeatTimer: null,
      state: initialState,
      isHost: true,
      pendingIce: [],
      remoteIceBuffer: [],
      closed: false,
      // Resilience
      actionLog: [], // recent actions for rollback/replay
      bufferedActions: [], // queued while disconnected
      reconnectionPlannedAt: 0,
      // Spectators
      allowSpectators: true,
      // Cross-tab identity dedupe
      playerInstanceId: Math.random().toString(36).slice(2),
    };

    // ================
    // Internal helpers
    // ================
    function sendCore(channel, obj) {
      try {
        if (ctx.closed) return;
        if (channel && channel.readyState === "open") {
          channel.send(JSON.stringify(obj));
        }
      } catch {}
    }
    function send(obj) {
      sendCore(ctx.dc, obj);
      // Mirror to spectators (read-only receive)
      for (const s of ctx.specChannels) sendCore(s, obj);
    }

    function broadcastSnapshot() {
      send({ type: "snapshot", state: ctx.state });
    }

    function recordAction(action) {
      ctx.actionLog.push({ at: now(), action, hash: ctx.state.hash, turnNumber: ctx.state.turnNumber });
      if (ctx.actionLog.length > config.actionLogLimit) ctx.actionLog.shift();
    }

    function rollbackToHash(targetHash) {
      // Find last matching hash
      const idx = ctx.actionLog.findIndex((e) => e.hash === targetHash);
      if (idx === -1) return false;
      // Recompute from baseline? Since we don't have baseline here,
      // request resync from peer (host snapshot) and then replay actions after idx.
      send({ type: "requestResync", toHash: targetHash });
      return true;
    }

    function reconcileHash(remoteHash) {
      if (remoteHash !== ctx.state.hash) {
        // Divergence detected; ask peer for canonical snapshot
        send({ type: "requestResync", toHash: ctx.state.hash });
        return false;
      }
      return true;
    }

    // ================
    // DataChannel events
    // ================
    dc.onmessage = (evt) => {
      ctx.lastActivityAt = now();
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }

      // Presence ping/pong
      if (msg.type === "ping") {
        ctx.peerOnline = true;
        send({ type: "pong" });
        return;
      }
      if (msg.type === "pong") {
        ctx.peerOnline = true;
        return;
      }

      // ICE candidate relay
      if (msg.type === "ice") {
        if (ctx.pc.remoteDescription) {
          ctx.pc.addIceCandidate(msg.candidate).catch(() => {});
        } else {
          ctx.remoteIceBuffer.push(msg.candidate);
        }
        return;
      }

      // Resync request
      if (msg.type === "requestResync") {
        // Host sends canonical snapshot (or either side if agreed)
        broadcastSnapshot();
        return;
      }

      // Spectator handshake (read-only)
      if (msg.type === "spectatorJoin") {
        // noop in main channel—spectators typically use a distinct channel
        return;
      }

      // Game snapshot reception
      if (msg.type === "snapshot") {
        const { state: next } = ctx.reducer(ctx.state, { type: "SYNC_SNAPSHOT", snapshot: msg.state }, ctx.localPlayerId);
        ctx.state = next;
        ctx.onEvent({ gameId: ctx.gameId, kind: "snapshot", state: deepClone(ctx.state) });
        ctx.onStatus({ gameId: ctx.gameId, status: "in-sync", hash: ctx.state.hash });
        if (ctx.state.currentTurn === ctx.localPlayerId) {
          notify("Your turn", `Game ${ctx.gameId}`);
          ctx.onStatus({ gameId: ctx.gameId, turn: "yours" });
        }
        return;
      }

      // Action reception
      if (msg.type === "action") {
        const remoteMeta = msg.action.meta || {};
        // Vector clock/lamport ordering protection
        // For simplicity, reducer validates internally via clocks; we still detect obvious staleness via optional fields
        const { state: next, error } = ctx.reducer(ctx.state, msg.action, ctx.localPlayerId);
        if (!error) {
          ctx.state = next;
          ctx.onEvent({ gameId: ctx.gameId, kind: "action", action: deepClone(msg.action), state: deepClone(ctx.state) });
          reconcileHash(msg.action.meta?.postHash ?? ctx.state.hash);
          // Turn notification if becomes ours
          if (ctx.state.currentTurn === ctx.localPlayerId) {
            notify("Your turn", `Game ${ctx.gameId}`);
            ctx.onStatus({ gameId: ctx.gameId, turn: "yours" });
          }
        } else {
          // reject silently or inform peer
          send({ type: "actionError", error });
        }
        return;
      }

      if (msg.type === "actionError") {
        ctx.onEvent({ gameId: ctx.gameId, kind: "actionError", error: msg.error });
        return;
      }
    };

    dc.onopen = () => {
      ctx.connectionReady = true;
      ctx.peerOnline = true;
      // Send initial canonical snapshot (host)
      broadcastSnapshot();
      startHeartbeat();
      ctx.onStatus({ gameId: ctx.gameId, status: "connected" });
      flushBufferedActions();
      cacheSDP("answer"); // cache current remote answer/offer for reconnection convenience
    };

    dc.onclose = () => {
      ctx.peerOnline = false;
      ctx.connectionReady = false;
      stopHeartbeat();
      ctx.onStatus({ gameId: ctx.gameId, status: "disconnected" });
      planReconnect();
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        if (ctx.connectionReady) {
          send({ type: "ice", candidate: e.candidate });
        } else {
          ctx.pendingIce.push(e.candidate);
        }
      }
    };

    // Heartbeat and presence
    function startHeartbeat() {
      stopHeartbeat();
      ctx.heartbeatTimer = setInterval(() => {
        ctx.lastHeartbeatAt = now();
        send({ type: "ping" });
        const ps = presenceState(ctx);
        ctx.onPresenceChange({ gameId: ctx.gameId, presence: ps, peerOnline: ctx.peerOnline });
      }, config.heartbeatIntervalMs);
    }
    function stopHeartbeat() {
      if (ctx.heartbeatTimer) clearInterval(ctx.heartbeatTimer);
      ctx.heartbeatTimer = null;
    }

    function flushBufferedActions() {
      if (!ctx.bufferedActions.length) return;
      // Sort buffered actions by lamport/counter if present
      ctx.bufferedActions.sort((a, b) => {
        if (config.useLamport) {
          return (a.meta?.lamport ?? 0) - (b.meta?.lamport ?? 0);
        }
        return (a.meta?.counter ?? 0) - (b.meta?.counter ?? 0);
      });
      for (const action of ctx.bufferedActions) {
        send({ type: "action", action });
      }
      ctx.bufferedActions = [];
    }

    function planReconnect() {
      const nowTs = now();
      if (nowTs - ctx.reconnectionPlannedAt < config.reconnectDebounceMs) return;
      ctx.reconnectionPlannedAt = nowTs;
      ctx.onReconnect({ gameId: ctx.gameId, status: "attempting" });
      // Try renegotiation using cached SDP if available
      // Note: In pure manual signaling, we'll expose helper API for user to re-share SDP.
    }

    // SDP cache helpers
    function sdpKey(kind) {
      return config.sdpCacheKeyPrefix + ctx.gameId + ":" + kind;
    }
    function cacheSDP(kind) {
      try {
        const local = ctx.pc.localDescription?.toJSON?.() || ctx.pc.localDescription;
        const remote = ctx.pc.remoteDescription?.toJSON?.() || ctx.pc.remoteDescription;
        const blob = { local, remote };
        localStorage.setItem(sdpKey(kind), JSON.stringify(blob));
      } catch {}
    }
    function getCachedSDP(kind) {
      try {
        const raw = localStorage.getItem(sdpKey(kind));
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    }

    // ================
    // Spectator support (read-only)
    // ================
    function addSpectatorChannel(channel) {
      if (!ctx.allowSpectators) return;
      ctx.specChannels.push(channel);
      // Push a snapshot immediately
      sendCore(channel, { type: "snapshot", state: ctx.state });
    }

    // ================
    // SDP handling
    // ================
    // async function createOffer() {
    //   const offer = await pc.createOffer();
    //   await pc.setLocalDescription(offer);
    //   return offer;
    // }

    async function createOffer() {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  // Use localDescription, which is guaranteed to be an RTCSessionDescription
  const desc = pc.localDescription;
  return desc && typeof desc.toJSON === 'function' ? desc.toJSON() : desc;
}

    async function applyAnswer(sdp) {
      const answer = new RTCSessionDescription(sdp);
      await pc.setRemoteDescription(answer);
      remoteDescriptionSet = true;
      // Flush buffered remote ICE candidates
      for (const c of ctx.remoteIceBuffer) {
        try {
          await pc.addIceCandidate(c);
        } catch {}
      }
      ctx.remoteIceBuffer = [];
    }

    // async function setRemoteOfferAndAnswer(remoteOfferSdp) {
    //   await pc.setRemoteDescription(new RTCSessionDescription(remoteOfferSdp));
    //   const answer = await pc.createAnswer();
    //   await pc.setLocalDescription(answer);
    //   return answer;
    // }
async function setRemoteOfferAndAnswer(remoteOffer) {
  await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  const desc = pc.localDescription;
  return desc && typeof desc.toJSON === 'function' ? desc.toJSON() : desc;
}


    function close() {
      ctx.closed = true;
      stopHeartbeat();
      try {
        dc.close();
      } catch {}
      try {
        pc.close();
      } catch {}
      for (const s of ctx.specChannels) {
        try {
          s.close();
        } catch {}
      }
    }

    return {
      ctx,
      // SDP
      createOffer,
      applyAnswer,
      setRemoteOfferAndAnswer,
      // Spectators
      addSpectatorChannel,
      // Lifecycle
      close,
      // Low-level send
      send: (obj) => send(obj),
      // Cache helpers
      cacheSDP,
      getCachedSDP,
    };
  }

  // =========================
  // Public API
  // =========================

  async function createGame({
    gameId,
    localPlayerId,
    initialState,
    reducer,
    onEvent,
    onStatus,
    onBeforeMove,
    onAfterMove,
    onPresenceChange,
    onReconnect,
  }) {
    if (games.has(gameId)) throw new Error("Game already exists");

    const baseState = {
      gameId,
      players: initialState?.players || [localPlayerId],
      currentTurn: initialState?.currentTurn || localPlayerId,
      turnNumber: initialState?.turnNumber || 0,
      payload: deepClone(initialState?.payload || {}),
      clocks: { lamport: 0, counters: { [localPlayerId]: 0 } },
      lastUpdatedAt: now(),
    };
    baseState.hash = hashJSON({ payload: baseState.payload, turnNumber: baseState.turnNumber, currentTurn: baseState.currentTurn, clocks: baseState.clocks });

    const g = createGameContext({
      gameId,
      localPlayerId,
      initialState: baseState,
      reducer,
      onEvent,
      onStatus,
      onBeforeMove,
      onAfterMove,
      onPresenceChange,
      onReconnect,
    });

    games.set(gameId, g);
    activeGameId = activeGameId || gameId;

    // Build shareable offer (manual signaling)
    const offer = await g.createOffer();

    
    const linkPayload = { gameId, offer: offer};//.toJSON() };
    return {
      gameId,
      link: JSON.stringify(linkPayload), // share this with joiner
      setAnswer: async (answerJson) => g.applyAnswer(answerJson),
      close: () => {
        g.close();
        games.delete(gameId);
        if (activeGameId === gameId) activeGameId = null;
      },
    };
  }

  async function joinGame({
    localPlayerId,
    link, // host's JSON offer string
    reducer,
    onEvent,
    onStatus,
    onBeforeMove,
    onAfterMove,
    onPresenceChange,
    onReconnect,
  }) {
    const parsed = JSON.parse(link);
    const { gameId, offer } = parsed;
    if (games.has(gameId)) throw new Error("Game already exists");

    const initialState = {
      gameId,
      players: [localPlayerId], // will be replaced by host snapshot on connect
      currentTurn: localPlayerId,
      turnNumber: 0,
      payload: {},
      clocks: { lamport: 0, counters: { [localPlayerId]: 0 } },
      lastUpdatedAt: now(),
    };
    initialState.hash = hashJSON({ payload: initialState.payload, turnNumber: initialState.turnNumber, currentTurn: initialState.currentTurn, clocks: initialState.clocks });

    const g = createGameContext({
      gameId,
      localPlayerId,
      initialState,
      reducer,
      onEvent,
      onStatus,
      onBeforeMove,
      onAfterMove,
      onPresenceChange,
      onReconnect,
    });

    const answer = await g.setRemoteOfferAndAnswer(offer);
    games.set(gameId, g);
    activeGameId = activeGameId || gameId;

    return {
      gameId,
      answer: JSON.stringify(answer),//.toJSON()), // send this back to host
      close: () => {
        g.close();
        games.delete(gameId);
        if (activeGameId === gameId) activeGameId = null;
      },
    };
  }

  // Interaction with game state

  function getState(gameId = activeGameId) {
    const g = games.get(gameId);
    return g ? deepClone(g.ctx.state) : null;
  }

  function verifyStateHash(gameId = activeGameId) {
    const g = games.get(gameId);
    if (!g) return { ok: false, error: "Game not found" };
    const recomputed = hashJSON({
      payload: g.ctx.state.payload,
      turnNumber: g.ctx.state.turnNumber,
      currentTurn: g.ctx.state.currentTurn,
      clocks: g.ctx.state.clocks,
    });
    return { ok: recomputed === g.ctx.state.hash, local: recomputed, stored: g.ctx.state.hash };
  }

  function makeMove(action, gameId = activeGameId) {
    const g = games.get(gameId);
    if (!g) throw new Error("Game not found");
    const ctx = g.ctx;

    // Lifecycle hook
    try {
      const hookResult = ctx.onBeforeMove({ gameId, action: deepClone(action), state: deepClone(ctx.state) });
      if (hookResult === false) return { ok: false, error: "Move blocked by onBeforeMove" };
    } catch {}

    // Enforce local turn lock
    if (ctx.state.currentTurn !== ctx.localPlayerId) {
      return { ok: false, error: "Not your turn." };
    }

    // Attach vector clock metadata
    const meta = { lamport: ctx.state.clocks?.lamport ?? 0, counter: ctx.state.clocks?.counters?.[ctx.localPlayerId] ?? 0 };
    const enriched = { ...action, type: "MAKE_MOVE", meta };

    // Apply reducer
    const { state: next, error } = ctx.reducer(ctx.state, enriched, ctx.localPlayerId);
    if (error) return { ok: false, error };

    ctx.state = next;
    ctx.lastActivityAt = now();

    // Post-hash for receiver validation
    enriched.meta.postHash = ctx.state.hash;

    // Record and broadcast
    g.ctx.onEvent({ gameId, kind: "action", action: deepClone(enriched), state: deepClone(ctx.state) });
    recordAction(enriched);

    // If disconnected, buffer the action; else send immediately
    if (!ctx.connectionReady || ctx.dc.readyState !== "open") {
      ctx.bufferedActions.push(enriched);
    } else {
      g.send({ type: "action", action: enriched });
    }

    // Lifecycle hook
    try {
      ctx.onAfterMove({ gameId, action: deepClone(enriched), state: deepClone(ctx.state) });
    } catch {}

    return { ok: true, state: deepClone(ctx.state) };
  }

  function forceSnapshot(gameId = activeGameId) {
    const g = games.get(gameId);
    if (!g) throw new Error("Game not found");
    g.send({ type: "snapshot", state: g.ctx.state });
    return deepClone(g.ctx.state);
  }

  function setActiveGame(gameId) {
    if (!games.has(gameId)) throw new Error("Unknown gameId");
    activeGameId = gameId;
    return activeGameId;
  }

  function getStatus(gameId = activeGameId) {
    const g = games.get(gameId);
    if (!g) return null;
    const ps = presenceState(g.ctx);
    return {
      gameId,
      connected: g.ctx.connectionReady,
      peerOnline: g.ctx.peerOnline,
      presence: ps,
      you: g.ctx.localPlayerId,
      turn: g.ctx.state?.currentTurn === g.ctx.localPlayerId ? "yours" : "theirs",
      hash: g.ctx.state?.hash,
    };
  }

  function configure(opts = {}) {
    Object.assign(config, opts);
  }

  function onUserActivity(gameId = activeGameId) {
    const g = games.get(gameId);
    if (!g) return;
    g.ctx.lastActivityAt = now();
  }

  function listGames() {
    return Array.from(games.keys());
  }

  function closeGame(gameId) {
    const g = games.get(gameId);
    if (!g) return false;
    g.close();
    games.delete(gameId);
    if (activeGameId === gameId) activeGameId = null;
    return true;
  }

  // =========================
  // Persistence hooks
  // =========================
  function saveState(gameId = activeGameId) {
    const g = games.get(gameId);
    if (!g) return null;
    const snapshot = {
      gameId,
      localPlayerId: g.ctx.localPlayerId,
      state: deepClone(g.ctx.state),
      clocks: deepClone(g.ctx.state.clocks),
      actionLog: deepClone(g.ctx.actionLog),
      bufferedActions: deepClone(g.ctx.bufferedActions),
      timestamp: now(),
    };
    try {
      localStorage.setItem(config.crossTabKeyPrefix + "snapshot:" + gameId, JSON.stringify(snapshot));
    } catch {}
    return snapshot;
  }

  function loadState(gameId, snapshot) {
    const g = games.get(gameId);
    if (!g) throw new Error("Game not found");
    if (!snapshot) {
      try {
        const raw = localStorage.getItem(config.crossTabKeyPrefix + "snapshot:" + gameId);
        snapshot = raw ? JSON.parse(raw) : null;
      } catch {}
    }
    if (!snapshot) return false;
    g.ctx.state = deepClone(snapshot.state);
    g.ctx.actionLog = deepClone(snapshot.actionLog || []);
    g.ctx.bufferedActions = deepClone(snapshot.bufferedActions || []);
    // Notify peer with snapshot when connected
    if (g.ctx.connectionReady) {
      g.send({ type: "snapshot", state: g.ctx.state });
    }
    return true;
  }

  // =========================
  // Spectator / Observer mode
  // =========================
  // Minimal helper: addSpectator via a second RTCPeerConnection
  async function addSpectator(gameId) {
    const g = games.get(gameId);
    if (!g) throw new Error("Game not found");

    const spc = new RTCPeerConnection({ iceServers: config.connectionIceServers });
    const sdc = spc.createDataChannel("spectator");
    sdc.onopen = () => {
      // Send initial snapshot
      g.ctx.onEvent({ gameId, kind: "spectatorConnected" });
      g.ctx.addSpectatorChannel(sdc);
    };
    sdc.onmessage = (evt) => {
      // Spectators are read-only; ignore incoming
    };

    const offer = await spc.createOffer();
    await spc.setLocalDescription(offer);
    const linkPayload = { gameId, spectator: true, offer: offer};//.toJSON() };
    return {
      link: JSON.stringify(linkPayload),
      setAnswer: async (answerJson) => {
        const answer = new RTCSessionDescription(answerJson);
        await spc.setRemoteDescription(answer);
      },
      close: () => {
        try { sdc.close(); } catch {}
        try { spc.close(); } catch {}
      },
    };
  }

  // =========================
  // Cross-tab / multi-device sync
  // =========================
  function enableCrossTabSync(playerId) {
    if (!bc) return false;
    bc.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg || !msg.type) return;

      if (msg.type === "stateUpdate") {
        const g = games.get(msg.gameId);
        if (!g) return;
        // Ignore if same instance to avoid loops
        if (msg.instanceId === g.ctx.playerInstanceId) return;
        g.ctx.state = deepClone(msg.state);
        g.ctx.onEvent({ gameId: msg.gameId, kind: "crossTabUpdate", state: deepClone(g.ctx.state) });
      }

      if (msg.type === "makeMove") {
        const g = games.get(msg.gameId);
        if (!g) return;
        if (msg.instanceId === g.ctx.playerInstanceId) return;
        makeMove(msg.action, msg.gameId);
      }
    };
    return true;
  }

  function broadcastCrossTabState(gameId = activeGameId) {
    if (!bc) return;
    const g = games.get(gameId);
    if (!g) return;
    bc.postMessage({ type: "stateUpdate", gameId, state: deepClone(g.ctx.state), instanceId: g.ctx.playerInstanceId });
  }

  // =========================
  // Public API surface return
  // =========================
  return {
    // Game lifecycle
    createGame,
    joinGame,
    closeGame,
    listGames,
    setActiveGame,
    // State & actions
    getState,
    makeMove,
    forceSnapshot,
    verifyStateHash,
    // Presence & status
    getStatus,
    onUserActivity,
    // Config
    configure,
    // Persistence
    saveState,
    loadState,
    // Spectators
    addSpectator,
    // Cross-tab
    enableCrossTabSync,
    broadcastCrossTabState,
  };
}