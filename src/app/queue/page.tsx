'use client';

import { useState, useEffect, useCallback } from 'react';
import { Play, PlaySquare, RefreshCw, RotateCcw, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react';

interface QueuedJob {
  id: string;
  title: string;
  employer: string;
  url: string;
  location?: string;
  fitScore: number;
  status: string;
  createdAt: string;
}

interface WorkerInfo {
  isRunning: boolean;
  activeJobsCount: number;
  processedCount: number;
  failedCount: number;
  currentJobId?: string;
}

export default function QueuePage() {
  const [jobs, setJobs] = useState<QueuedJob[]>([]);
  const [worker, setWorker] = useState<WorkerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/queue');
      if (res.ok) {
        const data = await res.json();
        setJobs(data.data?.jobs || []);
        setWorker(data.data?.worker || null);
      }
    } catch (err) {
      console.error('Failed to load queue:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  const handleProcessNext = async () => {
    setActionInProgress(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'process-next' }),
      });
      const data = await res.json();
      setActionMessage(data.message || 'Processed next job');
      fetchQueue();
    } catch {
      setActionMessage('Failed to trigger worker process');
    } finally {
      setActionInProgress(false);
    }
  };

  const handleProcessBatch = async () => {
    setActionInProgress(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'process-batch', batchSize: 3 }),
      });
      const data = await res.json();
      setActionMessage(data.message || 'Batch processing completed');
      fetchQueue();
    } catch {
      setActionMessage('Failed to trigger batch processing');
    } finally {
      setActionInProgress(false);
    }
  };

  const handleRequeue = async (jobId: string) => {
    try {
      await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'requeue', jobId }),
      });
      fetchQueue();
    } catch (err) {
      console.error('Requeue failed:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Application Queue</h1>
          <p className="text-slate-400 text-sm mt-1">
            Jobs ranked by FIT score awaiting autonomous Playwright form automation.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setLoading(true);
              fetchQueue();
            }}
            disabled={loading}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3 py-2 rounded-lg border border-slate-700 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleProcessNext}
            disabled={actionInProgress || jobs.length === 0}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3.5 py-2 rounded-lg transition disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            Process Next
          </button>
          <button
            onClick={handleProcessBatch}
            disabled={actionInProgress || jobs.length === 0}
            className="flex items-center gap-1.5 bg-indigo-700 hover:bg-indigo-600 text-white text-xs font-semibold px-3.5 py-2 rounded-lg transition disabled:opacity-50"
          >
            <PlaySquare className="w-3.5 h-3.5" />
            Run Batch (3)
          </button>
        </div>
      </div>

      {/* Action Notification */}
      {actionMessage && (
        <div className="bg-slate-900 border border-indigo-500/30 text-indigo-300 px-4 py-3 rounded-lg text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-indigo-400" />
          {actionMessage}
        </div>
      )}

      {/* Worker Status Widget */}
      {worker && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            <span className="flex h-3 w-3 relative">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  worker.isRunning ? 'bg-emerald-400' : 'bg-slate-400'
                }`}
              ></span>
              <span
                className={`relative inline-flex rounded-full h-3 w-3 ${
                  worker.isRunning ? 'bg-emerald-500' : 'bg-slate-500'
                }`}
              ></span>
            </span>
            <span className="font-medium text-slate-200">
              Worker Status: {worker.isRunning ? 'Active Processing' : 'Idle / Ready'}
            </span>
          </div>

          <div className="flex items-center gap-6 text-slate-400">
            <div>
              Processed Today: <span className="font-semibold text-white">{worker.processedCount}</span>
            </div>
            <div>
              Failed / Blocked: <span className="font-semibold text-rose-400">{worker.failedCount}</span>
            </div>
          </div>
        </div>
      )}

      {/* Queue Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center">
          <h2 className="text-sm font-semibold text-white">Pending Applications ({jobs.length})</h2>
          <span className="text-xs text-slate-400">Sorted by FIT Score (Desc)</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
              <tr>
                <th className="px-5 py-3">Rank & Fit</th>
                <th className="px-5 py-3">Role & Employer</th>
                <th className="px-5 py-3">Location</th>
                <th className="px-5 py-3">State</th>
                <th className="px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <AlertCircle className="w-6 h-6 text-slate-600" />
                      <span>The queue is currently empty. Ingest qualified jobs from the Overview page!</span>
                    </div>
                  </td>
                </tr>
              ) : (
                jobs.map((job, idx) => (
                  <tr key={job.id} className="hover:bg-slate-800/30 transition">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-500 text-[11px]">#{idx + 1}</span>
                        <span
                          className={`font-semibold px-2.5 py-0.5 rounded text-[11px] border ${
                            job.fitScore >= 80
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          }`}
                        >
                          {job.fitScore}% FIT
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-slate-100">{job.title}</div>
                      <div className="text-slate-400 text-[11px]">{job.employer}</div>
                    </td>
                    <td className="px-5 py-3.5 text-slate-400">{job.location || 'Remote'}</td>
                    <td className="px-5 py-3.5">
                      <span className="font-mono text-[10px] uppercase bg-amber-500/10 text-amber-300 border border-amber-500/20 px-2 py-0.5 rounded">
                        {job.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 flex items-center gap-3">
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-slate-400 hover:text-white transition"
                      >
                        Posting <ExternalLink className="w-3 h-3" />
                      </a>
                      <button
                        onClick={() => handleRequeue(job.id)}
                        title="Re-prioritize in queue"
                        className="inline-flex items-center gap-1 text-slate-400 hover:text-indigo-400 transition"
                      >
                        <RotateCcw className="w-3 h-3" /> Requeue
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
