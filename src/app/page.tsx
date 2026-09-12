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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-3">
            Mission Control
            <span className="text-xs bg-emerald-100 text-emerald-800 border border-emerald-300 px-2.5 py-0.5 rounded-full font-bold">
              Autonomous Pipeline
            </span>
          </h1>
          <p className="text-slate-600 text-sm font-medium mt-1">
            Deterministic qualification scoring, local Phi-3 screening, and automated Playwright execution.
          </p>
        </div>
        <button
          onClick={() => {
            setLoading(true);
            fetchData();
          }}
          disabled={loading}
          className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm px-4 py-2.5 rounded-lg border border-slate-300 shadow-xs transition"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-600' : 'text-slate-600'}`} />
          Refresh Stats
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200/90 rounded-xl p-5 shadow-xs hover:shadow-sm transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Total Evaluated</span>
            <div className="p-2.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
              <Briefcase className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-black text-slate-900">{totalJobs}</span>
            <span className="text-xs font-semibold text-slate-500">jobs analyzed</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-xl p-5 shadow-xs hover:shadow-sm transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">In Queue</span>
            <div className="p-2.5 rounded-lg bg-amber-50 text-amber-600 border border-amber-100">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-black text-amber-600">{queuedCount}</span>
            <span className="text-xs font-semibold text-slate-500">ready for worker</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-xl p-5 shadow-xs hover:shadow-sm transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Submitted</span>
            <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-black text-emerald-600">{submittedCount}</span>
            <span className="text-xs font-semibold text-slate-500">completed apps</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-xl p-5 shadow-xs hover:shadow-sm transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Action Needed</span>
            <div className="p-2.5 rounded-lg bg-rose-50 text-rose-600 border border-rose-100">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-black text-rose-600">{blockedCount}</span>
            <span className="text-xs font-semibold text-slate-500">manual reviews</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Add Job + Quick Worker Trigger */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Cols: Ingest New Job Form */}
        <div className="lg:col-span-2 bg-white border border-slate-200/90 rounded-xl p-6 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                <PlusCircle className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">Ingest Job Opportunity</h2>
            </div>
            <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full">
              Instant qualification scoring
            </span>
          </div>

          <form onSubmit={handleAddJob} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wide mb-1.5">
                Job Posting URL *
              </label>
              <input
                type="url"
                required
                placeholder="https://www.indeed.com/viewjob?jk=..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 shadow-xs transition"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-800 uppercase tracking-wide mb-1.5">
                  Job Title
                </label>
                <input
                  type="text"
                  placeholder="e.g. Senior Full Stack Engineer"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 shadow-xs transition"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 uppercase tracking-wide mb-1.5">
                  Company / Employer
                </label>
                <input
                  type="text"
                  placeholder="e.g. Acme Cloud Corp"
                  value={employer}
                  onChange={(e) => setEmployer(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 shadow-xs transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wide mb-1.5">
                Location & Mode
              </label>
              <input
                type="text"
                placeholder="Remote, Austin TX, Hybrid..."
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 shadow-xs transition"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wide mb-1.5">
                Job Description / Snippet (for Skill Scoring)
              </label>
              <textarea
                rows={3}
                placeholder="Paste key responsibilities, required skills (TypeScript, React, Node.js, SQL...)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 shadow-xs transition"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoQueue}
                  onChange={(e) => setAutoQueue(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-xs font-semibold text-slate-700">
                  Auto-queue for application if Fit Score &gt;= 50%
                </span>
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold px-5 py-2.5 rounded-lg shadow-sm shadow-indigo-600/20 transition disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                {submitting ? 'Scoring & Adding...' : 'Score & Ingest Job'}
              </button>
            </div>

            {addMessage && (
              <div
                className={`p-3.5 rounded-lg text-xs font-semibold mt-3 border ${
                  addMessage.isError
                    ? 'bg-rose-50 text-rose-800 border-rose-200'
                    : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                }`}
              >
                {addMessage.text}
              </div>
            )}
          </form>
        </div>

        {/* Right 1 Col: Quick Worker Action & Navigation */}
        <div className="space-y-6">
          <div className="bg-white border border-slate-200/90 rounded-xl p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-1 flex items-center gap-2">
              <Send className="w-4 h-4 text-indigo-600" />
              Queue Quick Controls
            </h3>
            <p className="text-xs font-medium text-slate-600 mb-4">
              Trigger background Playwright worker to execute top queued job.
            </p>
            <div className="space-y-2.5">
              <Link
                href="/queue"
                className="w-full flex items-center justify-between bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-2.5 px-4 rounded-lg shadow-sm shadow-indigo-600/20 transition"
              >
                <span>Open Queue Manager</span>
                <ChevronRight className="w-4 h-4" />
              </Link>
              <Link
                href="/manual-review"
                className="w-full flex items-center justify-between bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold py-2.5 px-4 rounded-lg border border-slate-300 shadow-xs transition"
              >
                <span>Manual Review Queue ({blockedCount})</span>
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

          {/* Quick Ledger Feed */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-5 shadow-xs">
            <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Recent Audit Trail
              </h3>
              <Link href="/ledger" className="text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:underline">
                View All
              </Link>
            </div>
            <div className="space-y-3">
              {events.length === 0 ? (
                <p className="text-xs font-medium text-slate-500 py-3">No events recorded yet.</p>
              ) : (
                events.map((evt) => {
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
                    <div key={evt.id} className="text-xs border-b border-slate-100 pb-2.5 last:border-none last:pb-0">
                      <div className="flex justify-between items-center">
                        <span className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded border ${badgeClass}`}>
                          {evt.type}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-500">
                          {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      {evt.job && (
                        <div className="text-slate-900 font-bold truncate mt-1">
                          {evt.job.title} <span className="text-slate-500 font-medium">· {evt.job.employer}</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Jobs Table */}
      <div className="bg-white border border-slate-200/90 rounded-xl overflow-hidden shadow-xs">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <h2 className="text-base font-bold text-slate-900">Recent Evaluated Jobs</h2>
          <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200">
            {jobs.length} loaded
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-800">
            <thead className="bg-slate-100 text-slate-700 uppercase tracking-wider text-[11px] font-bold border-b border-slate-200">
              <tr>
                <th className="px-5 py-3.5">Job Title & Employer</th>
                <th className="px-5 py-3.5">Location</th>
                <th className="px-5 py-3.5">Fit Score</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-slate-500 font-medium">
                    No jobs added yet. Use the form above to add a job posting!
                  </td>
                </tr>
              ) : (
                jobs.map((job) => {
                  const isSubmitted = job.status === 'SUBMITTED';
                  const isQueued = job.status === 'QUEUED';
                  const isApplying = job.status === 'APPLYING';
                  const isFailed = job.status.includes('FAIL') || job.status.includes('BLOCKED');
                  const statusBadgeClass = isSubmitted
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    : isQueued
                    ? 'bg-blue-100 text-blue-800 border-blue-300'
                    : isApplying
                    ? 'bg-indigo-100 text-indigo-800 border-indigo-300'
                    : isFailed
                    ? 'bg-rose-100 text-rose-800 border-rose-300'
                    : 'bg-slate-100 text-slate-700 border-slate-300';

                  return (
                    <tr key={job.id} className="hover:bg-slate-50 transition">
                      <td className="px-5 py-4">
                        <div className="font-bold text-slate-900 text-sm">{job.title}</div>
                        <div className="text-slate-500 font-medium text-xs mt-0.5">{job.employer}</div>
                      </td>
                      <td className="px-5 py-4 text-slate-600 font-medium">{job.location || 'Remote'}</td>
                      <td className="px-5 py-4">
                        <span
                          className={`font-bold px-2.5 py-1 rounded-md text-xs border ${
                            job.fitScore >= 80
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                              : job.fitScore >= 50
                              ? 'bg-amber-100 text-amber-900 border-amber-300'
                              : 'bg-rose-100 text-rose-800 border-rose-300'
                          }`}
                        >
                          {job.fitScore}%
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`font-mono text-[11px] font-bold uppercase px-2.5 py-1 rounded border ${statusBadgeClass}`}>
                          {job.status}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-semibold"
                        >
                          Source <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
