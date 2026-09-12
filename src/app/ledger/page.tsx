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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <BookOpenCheck className="w-6 h-6 text-indigo-400" />
            Immutable Event Ledger
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Complete audit trail of every state transition, form inspection, Ollama query, and submission.
          </p>
        </div>

        <button
          onClick={() => {
            setLoading(true);
            fetchLedger();
          }}
          disabled={loading}
          className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3 py-2 rounded-lg border border-slate-700 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 text-xs">
        <span className="text-slate-500 flex items-center gap-1">
          <Filter className="w-3.5 h-3.5" /> Filter:
        </span>
        <button
          onClick={() => setSelectedType('ALL')}
          className={`px-3 py-1.5 rounded-lg border transition ${
            selectedType === 'ALL'
              ? 'bg-indigo-600 text-white border-indigo-500'
              : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'
          }`}
        >
          All Events
        </button>
        {Object.entries(typeBreakdown).map(([type, count]) => (
          <button
            key={type}
            onClick={() => setSelectedType(type)}
            className={`px-3 py-1.5 rounded-lg border transition ${
              selectedType === type
                ? 'bg-indigo-600 text-white border-indigo-500'
                : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            {type} ({count})
          </button>
        ))}
      </div>

      {/* Event List */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center">
          <h2 className="text-sm font-semibold text-white">Recorded Events ({events.length})</h2>
          <span className="text-xs text-slate-400">Append-Only Cryptographic Consistency</span>
        </div>

        <div className="divide-y divide-slate-800/60">
          {events.length === 0 ? (
            <div className="p-10 text-center text-slate-500 text-xs">
              No events found matching criteria.
            </div>
          ) : (
            events.map((evt) => {
              const isExpanded = expandedId === evt.id;
              return (
                <div key={evt.id} className="p-4 hover:bg-slate-800/20 transition space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                        {evt.type}
                      </span>
                      {evt.job && (
                        <span className="text-xs text-slate-300 font-medium">
                          {evt.job.title} <span className="text-slate-500">@</span> {evt.job.employer}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-slate-500 font-mono">
                        {new Date(evt.timestamp).toLocaleString()}
                      </span>
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : evt.id)}
                        className="text-slate-400 hover:text-white p-1 rounded transition"
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Metadata display */}
                  {isExpanded && (
                    <div className="mt-3 p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono text-emerald-400 overflow-x-auto">
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
