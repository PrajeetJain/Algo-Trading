export const watchlist = [
  { exchange: "NSE", tradingsymbol: "RELIANCE", name: "Reliance Industries", sector: "Energy" },
  { exchange: "NSE", tradingsymbol: "HDFCBANK", name: "HDFC Bank", sector: "Banking" },
  { exchange: "NSE", tradingsymbol: "ICICIBANK", name: "ICICI Bank", sector: "Banking" },
  { exchange: "NSE", tradingsymbol: "INFY", name: "Infosys", sector: "IT Services" },
  { exchange: "NSE", tradingsymbol: "TCS", name: "Tata Consultancy", sector: "IT Services" },
  { exchange: "NSE", tradingsymbol: "SBIN", name: "State Bank of India", sector: "Banking" },
  { exchange: "NSE", tradingsymbol: "AXISBANK", name: "Axis Bank", sector: "Banking" },
  { exchange: "NSE", tradingsymbol: "LT", name: "Larsen & Toubro", sector: "Infrastructure" },
  { exchange: "NSE", tradingsymbol: "BHARTIARTL", name: "Bharti Airtel", sector: "Telecom" },
  { exchange: "NSE", tradingsymbol: "MARUTI", name: "Maruti Suzuki", sector: "Auto" },
  { exchange: "NSE", tradingsymbol: "TITAN", name: "Titan Company", sector: "Consumer" },
  { exchange: "NSE", tradingsymbol: "ULTRACEMCO", name: "UltraTech Cement", sector: "Materials" },
];

export const marketContextSymbols = [
  { exchange: "NSE", tradingsymbol: "NIFTY 50", name: "Nifty 50", sector: "Index" },
];

export function instrumentKey(item) {
  return `${item.exchange}:${item.tradingsymbol}`;
}
