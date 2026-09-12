'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Briefcase,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Send,
  PlusCircle,
  ExternalLink,
  ChevronRight,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

interface Job {
  id: string;
  title: string;
  employer: string;
  url: string;
  location?: string;
  fitScore: number;
  status: string;
  createdAt: string;
}

interface EventItem {
  id: string;
  type: string;
  timestamp: string;
  metadata: Record<string, unknown>;
  job?: { title: string; employer: string };
}

export default function DashboardOverview() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [employer, setEmployer] = useState('');
  const [location, setLocation] = useState('Remote');
  const [description, setDescription] = useState('');
  const [autoQueue, setAutoQueue] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [addMessage, setAddMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [jobsRes, ledgerRes] = await Promise.all([
        fetch('/api/jobs?limit=10'),
        fetch('/api/ledger?limit=8'),
      ]);

      if (jobsRes.ok) {
        const data = await jobsRes.json();
        setJobs(data.data || []);
        setSummary(data.summary || {});
      }

      if (ledgerRes.ok) {
        const lData = await ledgerRes.json();
        setEvents(lData.data || []);
      }
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setSubmitting(true);
    setAddMessage(null);

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          title,
          employer,
          location,
          description,
          autoQueue,
        }),
      });

      const json = await res.json();
      if (res.ok) {
        setAddMessage({
          text: `Job added successfully! FIT Score: ${json.qualification?.fitScore || 0}% (${json.qualification?.recommendation || 'Evaluated'})`,
        });
        setUrl('');
        setTitle('');
        setEmployer('');
        setDescription('');
        fetchData();
      } else {
        setAddMessage({ text: json.error || 'Failed to add job', isError: true });
      }
    } catch {
      setAddMessage({ text: 'Network error submitting job', isError: true });
    } finally {
      setSubmitting(false);
    }
  };

  const totalJobs = Object.values(summary).reduce((a, b) => a + b, 0);
  const queuedCount = summary['QUEUED'] || 0;
  const submittedCount = summary['SUBMITTED'] || 0;
  const blockedCount = (summary['BLOCKED_REQUIRES_MANUAL_ACTION'] || 0) + (summary['REQUIRES_MANUAL_ACTION'] || 0);

  return (
    <div className="space-y-8">
      {/* Top Banner & Refresh */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            Mission Control
            <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 rounded-full font-normal">
              Autonomous Pipeline
            </span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Deterministic qualification scoring, local Phi-3 screening, and automated Playwright execution.
          </p>
        </div>
        <button
          onClick={() => {
            setLoading(true);
            fetchData();
          }}
          disabled={loading}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm px-3.5 py-2 rounded-lg border border-slate-700 transition"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
          Refresh Stats
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Evaluated</span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
              <Briefcase className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white">{totalJobs}</span>
            <span className="text-xs text-slate-500">jobs analyzed</span>
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">In Queue</span>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-amber-400">{queuedCount}</span>
            <span className="text-xs text-slate-500">ready for worker</span>
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Submitted</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-emerald-400">{submittedCount}</span>
            <span className="text-xs text-slate-500">completed apps</span>
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Action Needed</span>
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-rose-400">{blockedCount}</span>
            <span className="text-xs text-slate-500">manual reviews</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Add Job + Quick Worker Trigger */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Cols: Ingest New Job Form */}
        <div className="lg:col-span-2 bg-slate-900/60 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-4 mb-5">
            <div className="flex items-center gap-2">
              <PlusCircle className="w-5 h-5 text-indigo-400" />
              <h2 className="text-lg font-semibold text-white">Ingest Job Opportunity</h2>
            </div>
            <span className="text-xs text-slate-400">Instant qualification scoring</span>
          </div>

          <form onSubmit={handleAddJob} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Job Posting URL *
              </label>
              <input
                type="url"
                required
                placeholder="https://www.indeed.com/viewjob?jk=..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Job Title
                </label>
                <input
                  type="text"
                  placeholder="e.g. Senior Full Stack Engineer"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Company / Employer
                </label>
                <input
                  type="text"
                  placeholder="e.g. Acme Cloud Corp"
                  value={employer}
                  onChange={(e) => setEmployer(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Location & Mode
              </label>
              <input
                type="text"
                placeholder="Remote, Austin TX, Hybrid..."
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Job Description / Snippet (for Skill Scoring)
              </label>
              <textarea
                rows={3}
                placeholder="Paste key responsibilities, required skills (TypeScript, React, Node.js, SQL...)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoQueue}
                  onChange={(e) => setAutoQueue(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-900 bg-slate-950"
                />
                <span className="text-xs text-slate-300">
                  Auto-queue for application if Fit Score &gt;= 50%
                </span>
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                {submitting ? 'Scoring & Adding...' : 'Score & Ingest Job'}
              </button>
            </div>

            {addMessage && (
              <div
                className={`p-3 rounded-lg text-xs mt-3 border ${
                  addMessage.isError
                    ? 'bg-rose-500/10 text-rose-300 border-rose-500/20'
                    : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                }`}
              >
                {addMessage.text}
              </div>
            )}
          </form>
        </div>

        {/* Right 1 Col: Quick Worker Action & Navigation */}
        <div className="space-y-6">
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
              <Send className="w-4 h-4 text-indigo-400" />
              Queue Quick Controls
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Trigger background Playwright worker to execute top queued job.
            </p>
            <div className="space-y-2.5">
              <Link
                href="/queue"
                className="w-full flex items-center justify-between bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2.5 px-4 rounded-lg transition"
              >
                <span>Open Queue Manager</span>
                <ChevronRight className="w-4 h-4" />
              </Link>
              <Link
                href="/manual-review"
                className="w-full flex items-center justify-between bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium py-2.5 px-4 rounded-lg border border-slate-700 transition"
              >
                <span>Manual Review Queue ({blockedCount})</span>
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

          {/* Quick Ledger Feed */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Recent Audit Trail
              </h3>
              <Link href="/ledger" className="text-xs text-indigo-400 hover:underline">
                View All
              </Link>
            </div>
            <div className="space-y-2.5">
              {events.length === 0 ? (
                <p className="text-xs text-slate-500 py-3">No events recorded yet.</p>
              ) : (
                events.map((evt) => (
                  <div key={evt.id} className="text-xs border-b border-slate-800/60 pb-2">
                    <div className="flex justify-between items-center text-slate-400">
                      <span className="font-mono text-[10px] text-indigo-400">{evt.type}</span>
                      <span className="text-[10px] text-slate-500">
                        {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {evt.job && (
                      <div className="text-slate-200 font-medium truncate mt-0.5">
                        {evt.job.title} - {evt.job.employer}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Jobs Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Recent Evaluated Jobs</h2>
          <span className="text-xs text-slate-400">{jobs.length} loaded</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
              <tr>
                <th className="px-5 py-3">Job Title & Employer</th>
                <th className="px-5 py-3">Location</th>
                <th className="px-5 py-3">Fit Score</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-slate-500">
                    No jobs added yet. Use the form above to add a job posting!
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-800/30 transition">
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-slate-100">{job.title}</div>
                      <div className="text-slate-400 text-[11px]">{job.employer}</div>
                    </td>
                    <td className="px-5 py-3.5 text-slate-400">{job.location || 'Remote'}</td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`font-semibold px-2 py-0.5 rounded text-[11px] border ${
                          job.fitScore >= 80
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : job.fitScore >= 50
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                        }`}
                      >
                        {job.fitScore}%
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="font-mono text-[10px] uppercase bg-slate-800 text-slate-300 px-2 py-1 rounded">
                        {job.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300"
                      >
                        Source <ExternalLink className="w-3 h-3" />
                      </a>
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
