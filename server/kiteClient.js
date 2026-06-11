import { createHash } from "node:crypto";
import { createRateLimiter } from "./rateLimiter.js";

const KITE_API_BASE = "https://api.kite.trade";
const KITE_WS_BASE = "wss://ws.kite.trade";

const kiteLimiter = createRateLimiter({
  quote: { label: "Quote", minIntervalMs: 1100 },
  historical: { label: "Historical candles", minIntervalMs: 350 },
  order: { label: "Order placement", minIntervalMs: 120 },
  other: { label: "Other Kite API", minIntervalMs: 120 },
});

function toForm(data) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null && value !== "") {
      form.set(key, String(value));
    }
  }
  return form;
}

export function createKiteClient({ apiKey, apiSecret, getAccessToken, setSession }) {
  function limiterKey(path, method) {
    if (path === "/quote") {
      return "quote";
    }
    if (path.startsWith("/instruments/historical/")) {
      return "historical";
    }
    if (path.startsWith("/orders") && method === "POST") {
      return "order";
    }
    return "other";
  }

  async function request(path, { method = "GET", query, body, auth = true } = {}) {
    return kiteLimiter.schedule(limiterKey(path, method), async () => {
      const url = new URL(`${KITE_API_BASE}${path}`);
      if (query) {
        for (const [key, value] of Object.entries(query)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              url.searchParams.append(key, String(item));
            }
          } else if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(key, String(value));
          }
        }
      }

      const headers = {
        "X-Kite-Version": "3",
      };

      if (auth) {
        const accessToken = getAccessToken();
        if (!apiKey || !accessToken) {
          throw new Error("Kite access token is not connected");
        }
        headers.Authorization = `token ${apiKey}:${accessToken}`;
      }

      const response = await fetch(url, {
        method,
        headers: body ? { ...headers, "Content-Type": "application/x-www-form-urlencoded" } : headers,
        body: body ? toForm(body) : undefined,
      });
      const payload = await response.json();

      if (!response.ok || payload.status === "error") {
        throw new Error(payload.message ?? `Kite API request failed: ${path}`);
      }
      return payload.data;
    });
  }

  return {
    configured: Boolean(apiKey && apiSecret),
    loginUrl() {
      if (!apiKey) {
        throw new Error("KITE_API_KEY is not configured");
      }
      return `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(apiKey)}`;
    },
    websocketUrl() {
      const accessToken = getAccessToken();
      if (!apiKey || !accessToken) {
        throw new Error("Kite access token is not connected");
      }
      const url = new URL(KITE_WS_BASE);
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("access_token", accessToken);
      return url.toString();
    },
    async createSession(requestToken) {
      if (!apiKey || !apiSecret) {
        throw new Error("Kite API key and secret are not configured");
      }
      const checksum = createHash("sha256").update(`${apiKey}${requestToken}${apiSecret}`).digest("hex");
      const data = await request("/session/token", {
        method: "POST",
        auth: false,
        body: {
          api_key: apiKey,
          request_token: requestToken,
          checksum,
        },
      });
      setSession(data.access_token, {
        userId: data.user_id,
        userName: data.user_name,
        email: data.email,
        broker: data.broker,
      });
      return data;
    },
    async quote(instruments) {
      return request("/quote", { query: { i: instruments } });
    },
    async instruments(exchange = "NSE") {
      const response = await kiteLimiter.schedule("other", () =>
        fetch(`${KITE_API_BASE}/instruments/${encodeURIComponent(exchange)}`, {
          headers: { "X-Kite-Version": "3" },
        })
      );
      if (!response.ok) {
        throw new Error("Unable to fetch Kite instruments");
      }
      return response.text();
    },
    rateLimits() {
      return kiteLimiter.status();
    },
    async orderStatus(orderId) {
      const orders = await request("/orders");
      return orders.find((order) => String(order.order_id) === String(orderId)) ?? null;
    },
    async waitForOrderStatus(orderId, attempts = 3) {
      let latest = null;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        latest = await this.orderStatus(orderId);
        if (latest?.status === "COMPLETE" || latest?.status === "REJECTED" || latest?.status === "CANCELLED") {
          return latest;
        }
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      return latest;
    },
    async historical(instrumentToken, interval, from, to) {
      return request(`/instruments/historical/${instrumentToken}/${interval}`, {
        query: {
          from,
          to,
        },
      });
    },
    async margins() {
      return request("/user/margins");
    },
    async positions() {
      return request("/portfolio/positions");
    },
    async orders() {
      return request("/orders");
    },
    async placeOrder(order) {
      const variety = order.variety ?? "regular";
      return request(`/orders/${variety}`, {
        method: "POST",
        body: {
          exchange: order.exchange ?? "NSE",
          tradingsymbol: order.tradingsymbol,
          transaction_type: order.transactionType,
          quantity: order.quantity,
          product: order.product ?? "MIS",
          order_type: order.orderType ?? "MARKET",
          price: order.price,
          trigger_price: order.triggerPrice,
          validity: order.validity ?? "DAY",
          tag: order.tag ?? "AINDRA_PAPER_GUARD",
        },
      });
    },
    async modifyOrder(order) {
      const variety = order.variety ?? "regular";
      return request(`/orders/${variety}/${order.orderId}`, {
        method: "PUT",
        body: {
          quantity: order.quantity,
          order_type: order.orderType,
          price: order.price,
          trigger_price: order.triggerPrice,
          validity: order.validity,
        },
      });
    },
    async cancelOrder(order) {
      const variety = order.variety ?? "regular";
      return request(`/orders/${variety}/${order.orderId}`, {
        method: "DELETE",
      });
    },
  };
}
