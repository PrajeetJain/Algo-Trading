import { strictEqual } from "node:assert";
import { test } from "node:test";
import { getMarketSession } from "../server/marketCalendar.js";

function ist(dateTime) {
  return new Date(`${dateTime}+05:30`);
}

test("preopen phase before 09:15", () => {
  const session = getMarketSession(ist("2026-06-10T09:14:00"));
  strictEqual(session.phase, "preopen");
  strictEqual(session.marketOpen, false);
  strictEqual(session.botArmAllowed, true);
});

test("market opens at 09:15", () => {
  const session = getMarketSession(ist("2026-06-10T09:15:00"));
  strictEqual(session.phase, "open");
  strictEqual(session.marketOpen, true);
  strictEqual(session.freshEntriesAllowed, false);
});

test("fresh entries allowed from 09:20", () => {
  strictEqual(getMarketSession(ist("2026-06-10T09:19:59")).freshEntriesAllowed, false);
  strictEqual(getMarketSession(ist("2026-06-10T09:20:00")).freshEntriesAllowed, true);
});

test("fresh entries blocked from 15:00, square-off due from 15:15", () => {
  const beforeCutoff = getMarketSession(ist("2026-06-10T14:59:00"));
  strictEqual(beforeCutoff.freshEntriesAllowed, true);
  strictEqual(beforeCutoff.squareOffDue, false);
  const afterCutoff = getMarketSession(ist("2026-06-10T15:00:00"));
  strictEqual(afterCutoff.freshEntriesAllowed, false);
  const squareOff = getMarketSession(ist("2026-06-10T15:15:00"));
  strictEqual(squareOff.squareOffDue, true);
  strictEqual(squareOff.marketOpen, true);
});

test("market open through 15:29, closing phase starts 15:30 with no gap", () => {
  strictEqual(getMarketSession(ist("2026-06-10T15:29:59")).phase, "open");
  strictEqual(getMarketSession(ist("2026-06-10T15:30:00")).phase, "closing");
  strictEqual(getMarketSession(ist("2026-06-10T15:35:00")).phase, "closing");
  strictEqual(getMarketSession(ist("2026-06-10T16:01:00")).phase, "closed");
});

test("weekend is a closed day", () => {
  const session = getMarketSession(ist("2026-06-13T11:00:00"));
  strictEqual(session.weekend, true);
  strictEqual(session.closedDay, true);
  strictEqual(session.marketOpen, false);
});

test("NSE 2026 holidays are closed days by default", () => {
  const muharram = getMarketSession(ist("2026-06-26T11:00:00"));
  strictEqual(muharram.holiday, true);
  strictEqual(muharram.closedDay, true);
  const republicDay = getMarketSession(ist("2026-01-26T11:00:00"));
  strictEqual(republicDay.holiday, true);
});

test("holiday list is not stale for 2026", () => {
  strictEqual(getMarketSession(ist("2026-06-10T11:00:00")).holidayListStale, false);
});

test("holiday list reports stale for a year with no entries", () => {
  strictEqual(getMarketSession(ist("2027-06-09T11:00:00")).holidayListStale, true);
});

test("next open skips weekend and holiday", () => {
  // Thursday 2026-06-25 after close: Friday 2026-06-26 is Muharram, then
  // weekend, so next open is Monday 2026-06-29.
  const session = getMarketSession(ist("2026-06-25T16:30:00"));
  strictEqual(session.nextOpenAt, "2026-06-29T09:15:00+05:30");
});
