import type { BotStatus, Config } from "../types";

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function formatCurrency(value: number, maxFractionDigits = 0) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(Math.round(value));
}

export function formatPercent(value: number, digits = 2) {
  return `${Number.isFinite(value) ? value.toFixed(digits) : "0.00"}%`;
}

export function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatNextOpen(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function nowLabel() {
  return new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function timeLabelFromIso(value: string) {
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function todayKey() {
  return new Date().toLocaleDateString("en-CA");
}

export function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    "kite-ws": "Kite WS",
    "kite-ws-rest-depth": "Kite WS+REST",
    "kite-rest": "Kite REST",
    "kite-error": "Kite error",
    simulator: "simulator",
    "local-sim": "local-sim",
  };
  return labels[source] ?? source;
}

export function strategyLabel(mode: Config["strategyMode"] | string | undefined) {
  const labels: Record<string, string> = {
    hybrid: "Hybrid",
    momentum: "Momentum",
    "mean-reversion": "Mean Rev",
    "vwap-pullback": "VWAP Pullback",
    "opening-range": "Opening Range",
  };
  return labels[mode ?? ""] ?? "Hybrid";
}

export function statusLabel(status: BotStatus) {
  const labels: Record<BotStatus, string> = {
    idle: "Idle",
    running: "Running",
    paused: "Paused",
    "target-hit": "Target Hit",
    "loss-hit": "Risk Stop",
    closed: "Closed",
  };
  return labels[status];
}

export function csvEscape(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.split('"').join('""')}"` : text;
}

export function toCsv(rows: Array<Record<string, string | number>>) {
  if (!rows.length) {
    return "";
  }
  const headers = Object.keys(rows[0]);
  const body = rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","));
  return [headers.join(","), ...body].join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function configQuery(config: Config) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(config)) {
    params.set(key, String(value));
  }
  return params.toString();
}
