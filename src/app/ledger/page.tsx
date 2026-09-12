'use client';

import { useState, useEffect, useCallback } from 'react';
import { BookOpenCheck, Filter, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

interface LedgerEntry {
  id: string;
  type: string;
  timestamp: string;
  metadata: Record<string, unknown>;
  job?: { title: string; employer: string; url: string };
  application?: { status: string; submittedAt?: string };
}

export default function LedgerPage() {
  const [events, setEvents] = useState<LedgerEntry[]>([]);
  const [typeBreakdown, setTypeBreakdown] = useState<Record<string, number>>({});
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchLedger = useCallback(async () => {
    try {
      const url = selectedType === 'ALL' ? '/api/ledger?limit=100' : `/api/ledger?type=${selectedType}&limit=100`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.data || []);
        if (selectedType === 'ALL') {
          setTypeBreakdown(data.typeBreakdown || {});
        }
      }
    } catch (err) {
      console.error('Failed to fetch ledger:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedType]);

  useEffect(() => {
    fetchLedger();
  }, [fetchLedger]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100">
              <BookOpenCheck className="w-6 h-6" />
            </div>
            Immutable Event Ledger
          </h1>
          <p className="text-slate-600 text-sm font-medium mt-1">
            Complete audit trail of every state transition, form inspection, Ollama query, and submission.
          </p>
        </div>

        <button
          onClick={() => {
            setLoading(true);
            fetchLedger();
          }}
          disabled={loading}
          className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold px-3.5 py-2.5 rounded-lg border border-slate-300 shadow-xs transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-600' : 'text-slate-600'}`} />
          Refresh
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 text-xs">
        <span className="text-slate-600 font-bold flex items-center gap-1">
          <Filter className="w-3.5 h-3.5" /> Filter:
        </span>
        <button
          onClick={() => setSelectedType('ALL')}
          className={`px-3.5 py-1.5 rounded-lg border text-xs transition ${
            selectedType === 'ALL'
              ? 'bg-indigo-600 text-white border-indigo-600 font-bold shadow-xs'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 font-semibold shadow-xs'
          }`}
        >
          All Events
        </button>
        {Object.entries(typeBreakdown).map(([type, count]) => (
          <button
            key={type}
            onClick={() => setSelectedType(type)}
            className={`px-3.5 py-1.5 rounded-lg border text-xs transition ${
              selectedType === type
                ? 'bg-indigo-600 text-white border-indigo-600 font-bold shadow-xs'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 font-semibold shadow-xs'
            }`}
          >
            {type} ({count})
          </button>
        ))}
      </div>

      {/* Event List */}
      <div className="bg-white border border-slate-200/90 rounded-xl overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
          <h2 className="text-sm font-bold text-slate-900">Recorded Events ({events.length})</h2>
          <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200">
            Append-Only Cryptographic Consistency
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {events.length === 0 ? (
            <div className="p-10 text-center text-slate-500 font-medium text-xs">
              No events found matching criteria.
            </div>
          ) : (
            events.map((evt) => {
              const isExpanded = expandedId === evt.id;
              const isSuccess = evt.type === 'SUBMISSION_CONFIRMED';
              const isQueued = evt.type === 'QUEUED';
              const isDiscovered = evt.type === 'DISCOVERED';
              const isFailed = evt.type.includes('FAIL') || evt.type.includes('BLOCKED');
              const badgeClass = isSuccess
                ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                : isQueued
                ? 'bg-blue-100 text-blue-800 border-blue-300'
                : isDiscovered
                ? 'bg-indigo-100 text-indigo-800 border-indigo-300'
                : isFailed
                ? 'bg-rose-100 text-rose-800 border-rose-300'
                : 'bg-amber-100 text-amber-900 border-amber-300';

              return (
                <div key={evt.id} className="p-4 hover:bg-slate-50 transition space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span className={`font-mono text-xs font-bold px-2.5 py-1 rounded border ${badgeClass}`}>
                        {evt.type}
                      </span>
                      {evt.job && (
                        <span className="text-xs text-slate-900 font-bold">
                          {evt.job.title} <span className="text-slate-500 font-medium">@ {evt.job.employer}</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-slate-500 font-semibold font-mono">
                        {new Date(evt.timestamp).toLocaleString()}
                      </span>
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : evt.id)}
                        className="text-slate-500 hover:text-slate-900 p-1 rounded transition"
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Metadata display */}
                  {isExpanded && (
                    <div className="mt-3 p-3 bg-slate-900 rounded-lg border border-slate-800 text-xs font-mono text-emerald-300 overflow-x-auto shadow-inner">
                      <pre>{JSON.stringify(evt.metadata, null, 2)}</pre>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
