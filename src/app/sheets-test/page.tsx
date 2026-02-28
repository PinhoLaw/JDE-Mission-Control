"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, AlertCircle, FileSpreadsheet } from "lucide-react";

type SheetRow = Record<string, string | number | null>;

export default function SheetsTestPage() {
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read", sheetTitle: "Sheet18" }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
      }

      const data = await res.json();

      // Support both { rows: [...] } and direct array responses
      const rawRows: unknown[][] = Array.isArray(data)
        ? data
        : Array.isArray(data.rows)
          ? data.rows
          : Array.isArray(data.values)
            ? data.values
            : [];

      if (rawRows.length === 0) {
        setHeaders([]);
        setRows([]);
        setLastFetched(new Date().toLocaleTimeString());
        return;
      }

      // First row → headers
      const hdrs = (rawRows[0] as (string | number | null)[]).map(
        (h, i) => (h != null && String(h).trim() !== "" ? String(h).trim() : `Column ${i + 1}`),
      );
      setHeaders(hdrs);

      // Remaining rows → data objects keyed by header
      const dataRows = rawRows.slice(1).map((row) => {
        const obj: SheetRow = {};
        hdrs.forEach((h, i) => {
          obj[h] = (row as (string | number | null)[])[i] ?? null;
        });
        return obj;
      });

      setRows(dataRows);
      setLastFetched(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* ── Header Bar ── */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                Sheets Test &mdash; Sheet18
              </h1>
              {lastFetched && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Last updated {lastFetched}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={fetchData}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:shadow active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Refreshing..." : "Refresh Data"}
          </button>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Loading State */}
        {loading && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="relative mb-4">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-primary dark:border-slate-700 dark:border-t-primary" />
            </div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Loading Sheet18 data&hellip;
            </p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900/50 dark:bg-red-950/30">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
              <div>
                <h3 className="text-sm font-semibold text-red-800 dark:text-red-300">
                  Failed to load data
                </h3>
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
                <button
                  onClick={fetchData}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60"
                >
                  <RefreshCw className="h-3 w-3" />
                  Try Again
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 py-20 dark:border-slate-700">
            <FileSpreadsheet className="mb-3 h-10 w-10 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              No data found in Sheet18
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              The sheet may be empty or the API returned no rows.
            </p>
          </div>
        )}

        {/* Data Table */}
        {!loading && !error && rows.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {/* Table info bar */}
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-slate-800">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {rows.length}
                </span>{" "}
                {rows.length === 1 ? "row" : "rows"} &middot;{" "}
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {headers.length}
                </span>{" "}
                columns
              </p>
            </div>

            {/* Scrollable table container */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/50">
                    <th className="sticky left-0 z-[1] whitespace-nowrap bg-slate-50 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      #
                    </th>
                    {headers.map((h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.map((row, ri) => (
                    <tr
                      key={ri}
                      className="transition-colors hover:bg-slate-50/60 dark:hover:bg-slate-800/40"
                    >
                      <td className="sticky left-0 z-[1] whitespace-nowrap bg-white px-5 py-3 text-xs font-medium tabular-nums text-slate-400 dark:bg-slate-900 dark:text-slate-500">
                        {ri + 1}
                      </td>
                      {headers.map((h) => {
                        const val = row[h];
                        const display = val != null && val !== "" ? String(val) : "";
                        const isDollar = /^-?\$/.test(display);
                        const isNeg = /^-/.test(display);
                        return (
                          <td
                            key={h}
                            className={`whitespace-nowrap px-5 py-3 text-sm ${
                              isDollar
                                ? isNeg
                                  ? "font-medium tabular-nums text-red-600 dark:text-red-400"
                                  : "font-medium tabular-nums text-emerald-600 dark:text-emerald-400"
                                : display === ""
                                  ? "text-slate-300 dark:text-slate-600"
                                  : "text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            {display || "\u2014"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
