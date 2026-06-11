import { marketContextSymbols, watchlist } from "./watchlist.js";

const PRICE_DIVISOR = 100;
const FRESH_TICK_MS = 6000;

function asArrayBuffer(data) {
  if (data instanceof ArrayBuffer) {
    return data;
  }
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  return null;
}

function packetOffsets(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 2) {
    return [];
  }
  const packets = [];
  const count = view.getUint16(0);
  let offset = 2;
  for (let index = 0; index < count && offset + 2 <= buffer.byteLength; index += 1) {
    const length = view.getUint16(offset);
    offset += 2;
    if (offset + length > buffer.byteLength) {
      break;
    }
    packets.push({ offset, length });
    offset += length;
  }
  return packets;
}

function readPrice(view, offset) {
  return view.getInt32(offset) / PRICE_DIVISOR;
}

function readDepth(view, offset) {
  if (view.byteLength < offset + 120) {
    return {};
  }
  return {
    bestBid: readPrice(view, offset + 8),
    bestAsk: readPrice(view, offset + 68),
  };
}

function parsePacket(view, packet, tokenLookup) {
  if (packet.length < 8) {
    return null;
  }
  const instrumentToken = view.getInt32(packet.offset);
  const item = tokenLookup.get(instrumentToken);
  if (!item) {
    return null;
  }

  const ltp = readPrice(view, packet.offset + 4);
  const fullOrQuote = packet.length >= 44;
  const open = fullOrQuote ? readPrice(view, packet.offset + 28) : ltp;
  const high = fullOrQuote ? readPrice(view, packet.offset + 32) : ltp;
  const low = fullOrQuote ? readPrice(view, packet.offset + 36) : ltp;
  const close = fullOrQuote ? readPrice(view, packet.offset + 40) : ltp;
  const volume = packet.length >= 32 ? view.getUint32(packet.offset + 16) : 0;
  const depthPresent = packet.length >= 184;
  const depth = depthPresent ? readDepth(view, packet.offset + 64) : {};
  const rawBestBid = depth.bestBid ?? ltp;
  const rawBestAsk = depth.bestAsk ?? ltp;
  const rawSpreadBps = ltp ? ((rawBestAsk - rawBestBid) / ltp) * 10000 : 999;
  const validDepth =
    depthPresent &&
    Number.isFinite(rawBestBid) &&
    Number.isFinite(rawBestAsk) &&
    rawBestBid > 0 &&
    rawBestAsk > 0 &&
    rawBestAsk >= rawBestBid &&
    Number.isFinite(rawSpreadBps) &&
    rawSpreadBps > 0 &&
    rawSpreadBps <= 1000;
  const bestBid = validDepth ? rawBestBid : ltp;
  const bestAsk = validDepth ? rawBestAsk : ltp;

  return {
    instrument: `${item.exchange}:${item.tradingsymbol}`,
    exchange: item.exchange,
    symbol: item.tradingsymbol,
    name: item.name,
    sector: item.sector,
    source: "kite-ws",
    instrumentToken,
    ltp,
    open,
    high,
    low,
    close,
    volume,
    bestBid,
    bestAsk,
    spreadBps: validDepth ? rawSpreadBps : 999,
    lastTradeTime: new Date().toISOString(),
  };
}

export function createKiteMarketStream({ kiteClient }) {
  let ws = null;
  let state = "idle";
  let reconnectTimer = null;
  let reconnects = 0;
  let tickCount = 0;
  let lastTickAt = null;
  let tokenLookup = new Map();
  let subscribedTokens = [];
  let latestBySymbol = new Map();
  let lastError = "";
  let shouldRun = false;

  function status() {
    const stale = !lastTickAt || Date.now() - Date.parse(lastTickAt) > FRESH_TICK_MS;
    return {
      state,
      subscribed: subscribedTokens.length,
      tickCount,
      lastTickAt,
      stale,
      reconnects,
      lastError,
      source: stale ? "rest-fallback" : "kite-ws",
    };
  }

  function closeSocket() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  function send(payload) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  function scheduleReconnect() {
    if (!shouldRun || reconnectTimer) {
      return;
    }
    state = "reconnecting";
    reconnects += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      start();
    }, Math.min(30000, 3000 + reconnects * 2000));
  }

  function handleMessage(event) {
    const buffer = asArrayBuffer(event.data);
    if (!buffer) {
      return;
    }
    const view = new DataView(buffer);
    for (const packet of packetOffsets(buffer)) {
      const quote = parsePacket(view, packet, tokenLookup);
      if (!quote) {
        continue;
      }
      latestBySymbol.set(quote.symbol, quote);
      lastTickAt = quote.lastTradeTime;
      tickCount += 1;
    }
  }

  function start(instrumentMap = null) {
    if (instrumentMap) {
      const items = [...watchlist, ...marketContextSymbols];
      tokenLookup = new Map();
      subscribedTokens = [];
      for (const item of items) {
        const token = instrumentMap[item.tradingsymbol]?.instrumentToken;
        if (token) {
          tokenLookup.set(Number(token), item);
          subscribedTokens.push(Number(token));
        }
      }
    }

    if (!subscribedTokens.length || state === "connecting" || state === "open") {
      return status();
    }

    shouldRun = true;
    closeSocket();
    try {
      state = "connecting";
      ws = new WebSocket(kiteClient.websocketUrl());
      ws.binaryType = "arraybuffer";
      ws.addEventListener("open", () => {
        state = "open";
        reconnects = 0;
        lastError = "";
        send({ a: "subscribe", v: subscribedTokens });
        send({ a: "mode", v: ["full", subscribedTokens] });
      });
      ws.addEventListener("message", handleMessage);
      ws.addEventListener("error", (event) => {
        lastError = event.message ?? "WebSocket error";
      });
      ws.addEventListener("close", () => {
        state = "closed";
        if (shouldRun) {
          scheduleReconnect();
        }
      });
    } catch (error) {
      state = "error";
      lastError = error instanceof Error ? error.message : "Unable to start Kite stream";
      scheduleReconnect();
    }
    return status();
  }

  function stop() {
    shouldRun = false;
    state = "stopped";
    closeSocket();
    return status();
  }

  function quotes(items) {
    const streamFresh = lastTickAt && Date.now() - Date.parse(lastTickAt) <= FRESH_TICK_MS;
    if (!streamFresh) {
      return [];
    }
    return items.map((item) => latestBySymbol.get(item.tradingsymbol)).filter(Boolean);
  }

  return {
    start,
    stop,
    status,
    quotes,
  };
}
