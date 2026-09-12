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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">Application Queue</h1>
          <p className="text-slate-600 text-sm font-medium mt-1">
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
            className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold px-3.5 py-2.5 rounded-lg border border-slate-300 shadow-xs transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-600' : 'text-slate-600'}`} />
            Refresh
          </button>
          <button
            onClick={handleProcessNext}
            disabled={actionInProgress || jobs.length === 0}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2.5 rounded-lg shadow-sm shadow-indigo-600/20 transition disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            Process Next
          </button>
          <button
            onClick={handleProcessBatch}
            disabled={actionInProgress || jobs.length === 0}
            className="flex items-center gap-1.5 bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-bold px-4 py-2.5 rounded-lg shadow-sm shadow-indigo-700/20 transition disabled:opacity-50"
          >
            <PlaySquare className="w-3.5 h-3.5" />
            Run Batch (3)
          </button>
        </div>
      </div>

      {/* Action Notification */}
      {actionMessage && (
        <div className="bg-indigo-50 border border-indigo-200 text-indigo-900 px-4 py-3 rounded-lg text-xs font-semibold flex items-center gap-2 shadow-xs">
          <CheckCircle2 className="w-4 h-4 text-indigo-600" />
          {actionMessage}
        </div>
      )}

      {/* Worker Status Widget */}
      {worker && (
        <div className="bg-white border border-slate-200/90 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs shadow-xs">
          <div className="flex items-center gap-3">
            <span className="flex h-3 w-3 relative">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  worker.isRunning ? 'bg-emerald-400' : 'bg-slate-400'
                }`}
              ></span>
              <span
                className={`relative inline-flex rounded-full h-3 w-3 ${
                  worker.isRunning ? 'bg-emerald-500' : 'bg-slate-400'
                }`}
              ></span>
            </span>
            <span className="font-bold text-slate-900">
              Worker Status: {worker.isRunning ? 'Active Processing' : 'Idle / Ready'}
            </span>
          </div>

          <div className="flex items-center gap-6 text-slate-600 font-medium">
            <div>
              Processed Today: <span className="font-extrabold text-slate-900">{worker.processedCount}</span>
            </div>
            <div>
              Failed / Blocked: <span className="font-extrabold text-rose-600">{worker.failedCount}</span>
            </div>
          </div>
        </div>
      )}

      {/* Queue Table */}
      <div className="bg-white border border-slate-200/90 rounded-xl overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
          <h2 className="text-sm font-bold text-slate-900">Pending Applications ({jobs.length})</h2>
          <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200">
            Sorted by FIT Score (Desc)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-800">
            <thead className="bg-slate-100 text-slate-700 uppercase tracking-wider text-[11px] font-bold border-b border-slate-200">
              <tr>
                <th className="px-5 py-3.5">Rank & Fit</th>
                <th className="px-5 py-3.5">Role & Employer</th>
                <th className="px-5 py-3.5">Location</th>
                <th className="px-5 py-3.5">State</th>
                <th className="px-5 py-3.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-slate-500 font-medium">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <AlertCircle className="w-6 h-6 text-slate-400" />
                      <span>The queue is currently empty. Ingest qualified jobs from the Overview page!</span>
                    </div>
                  </td>
                </tr>
              ) : (
                jobs.map((job, idx) => (
                  <tr key={job.id} className="hover:bg-slate-50 transition">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-500 font-bold text-[11px]">#{idx + 1}</span>
                        <span
                          className={`font-bold px-2.5 py-1 rounded-md text-xs border ${
                            job.fitScore >= 80
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                              : 'bg-amber-100 text-amber-900 border-amber-300'
                          }`}
                        >
                          {job.fitScore}% FIT
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-bold text-slate-900 text-sm">{job.title}</div>
                      <div className="text-slate-500 font-medium text-xs mt-0.5">{job.employer}</div>
                    </td>
                    <td className="px-5 py-4 text-slate-600 font-medium">{job.location || 'Remote'}</td>
                    <td className="px-5 py-4">
                      <span className="font-mono text-[11px] font-bold uppercase bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-1 rounded">
                        {job.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 flex items-center gap-4">
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-semibold"
                      >
                        Posting <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      <button
                        onClick={() => handleRequeue(job.id)}
                        title="Re-prioritize in queue"
                        className="inline-flex items-center gap-1 text-slate-600 hover:text-indigo-600 font-semibold transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Requeue
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
