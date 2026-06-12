export const watchlist = [
  { exchange: "NSE", tradingsymbol: "RELIANCE", name: "Reliance Industries", sector: "Energy" },
  { exchange: "NSE", tradingsymbol: "HDFCBANK", name: "HDFC Bank", sector: "Banking" },
  { exchange: "NSE", tradingsymbol: "ICICIBANK", name: "ICICI Bank", sector: "Banking" },
  { exchange: "NSE", tradingsymbol: "SBIN", name: "State Bank of India", sector: "Banking" },
  { exchange: "NSE", tradingsymbol: "AXISBANK", name: "Axis Bank", sector: "Banking" },
  { exchange: "NSE", tradingsymbol: "KOTAKBANK", name: "Kotak Mahindra Bank", sector: "Banking" },
  { exchange: "NSE", tradingsymbol: "INFY", name: "Infosys", sector: "IT Services" },
  { exchange: "NSE", tradingsymbol: "TCS", name: "Tata Consultancy", sector: "IT Services" },
  { exchange: "NSE", tradingsymbol: "HCLTECH", name: "HCL Technologies", sector: "IT Services" },
  { exchange: "NSE", tradingsymbol: "TECHM", name: "Tech Mahindra", sector: "IT Services" },
  { exchange: "NSE", tradingsymbol: "LT", name: "Larsen & Toubro", sector: "Infrastructure" },
  { exchange: "NSE", tradingsymbol: "BHARTIARTL", name: "Bharti Airtel", sector: "Telecom" },
  { exchange: "NSE", tradingsymbol: "MARUTI", name: "Maruti Suzuki", sector: "Auto" },
  // TATAMOTORS ceased trading after the 2025 demerger — replaced with
  // another liquid Auto large cap so the sector keeps 3 members.
  { exchange: "NSE", tradingsymbol: "EICHERMOT", name: "Eicher Motors", sector: "Auto" },
  { exchange: "NSE", tradingsymbol: "M&M", name: "Mahindra & Mahindra", sector: "Auto" },
  { exchange: "NSE", tradingsymbol: "TITAN", name: "Titan Company", sector: "Consumer" },
  { exchange: "NSE", tradingsymbol: "HINDUNILVR", name: "Hindustan Unilever", sector: "Consumer" },
  { exchange: "NSE", tradingsymbol: "ITC", name: "ITC", sector: "Consumer" },
  { exchange: "NSE", tradingsymbol: "ULTRACEMCO", name: "UltraTech Cement", sector: "Materials" },
  { exchange: "NSE", tradingsymbol: "TATASTEEL", name: "Tata Steel", sector: "Materials" },
  { exchange: "NSE", tradingsymbol: "JSWSTEEL", name: "JSW Steel", sector: "Materials" },
  { exchange: "NSE", tradingsymbol: "SUNPHARMA", name: "Sun Pharma", sector: "Pharma" },
  { exchange: "NSE", tradingsymbol: "CIPLA", name: "Cipla", sector: "Pharma" },
  { exchange: "NSE", tradingsymbol: "BAJFINANCE", name: "Bajaj Finance", sector: "Financials" },
  { exchange: "NSE", tradingsymbol: "NTPC", name: "NTPC", sector: "Energy" },
  { exchange: "NSE", tradingsymbol: "ONGC", name: "ONGC", sector: "Energy" },
];

export const marketContextSymbols = [
  { exchange: "NSE", tradingsymbol: "NIFTY 50", name: "Nifty 50", sector: "Index" },
  { exchange: "NSE", tradingsymbol: "NIFTY BANK", name: "Nifty Bank", sector: "Index" },
  { exchange: "NSE", tradingsymbol: "INDIA VIX", name: "India VIX", sector: "Index" },
];

export function instrumentKey(item) {
  return `${item.exchange}:${item.tradingsymbol}`;
}
