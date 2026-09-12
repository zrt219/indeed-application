'use client';

import { useState, useEffect, useCallback } from 'react';
import { ShieldAlert, CheckCircle2, BookmarkPlus, HelpCircle, Briefcase, RefreshCw } from 'lucide-react';

interface ReviewItem {
  id: string;
  question: string;
  context?: string;
  suggestedAnswer?: string;
  status: string;
  createdAt: string;
  job?: { id: string; title: string; employer: string; url: string };
  application?: { id: string; status: string };
}

export default function ManualReviewPage() {
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saveToBank, setSaveToBank] = useState<Record<string, boolean>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  const fetchReviews = useCallback(async () => {
    try {
      const res = await fetch('/api/manual-review?status=PENDING');
      if (res.ok) {
        const data = await res.json();
        setReviews(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch reviews:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  const handleResolve = async (reviewId: string) => {
    const answer = answers[reviewId];
    if (!answer || !answer.trim()) return;

    setResolvingId(reviewId);
    setNotification(null);

    try {
      const res = await fetch('/api/manual-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewId,
          resolvedAnswer: answer.trim(),
          addToAnswerBank: saveToBank[reviewId] ?? true,
          category: 'CUSTOM',
        }),
      });

      if (res.ok) {
        setNotification('Answer saved! If no other questions remain for this job, it has been re-queued.');
        fetchReviews();
      } else {
        const errData = await res.json();
        setNotification(`Error: ${errData.error || 'Failed to resolve'}`);
      }
    } catch {
      setNotification('Failed to resolve due to network error');
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-rose-400" />
            Manual Review & Human-in-the-Loop
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Strict anti-hallucination guardrails halt automation whenever facts are absent from the profile.
          </p>
        </div>

        <button
          onClick={() => {
            setLoading(true);
            fetchReviews();
          }}
          disabled={loading}
          className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3 py-2 rounded-lg border border-slate-700 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
          Refresh Items
        </button>
      </div>

      {notification && (
        <div className="bg-slate-900 border border-emerald-500/30 text-emerald-300 px-4 py-3 rounded-lg text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          {notification}
        </div>
      )}

      {/* Questions list */}
      <div className="space-y-4">
        {reviews.length === 0 ? (
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-10 text-center text-slate-400">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <h3 className="text-base font-semibold text-white">All Clear!</h3>
            <p className="text-xs text-slate-500 mt-1">
              There are no pending manual questions. The automated pipeline is operating without blocks.
            </p>
          </div>
        ) : (
          reviews.map((rev) => (
            <div
              key={rev.id}
              className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded bg-rose-500/10 text-rose-400">
                    <HelpCircle className="w-4 h-4" />
                  </span>
                  <div>
                    <span className="text-xs font-mono text-rose-400 uppercase tracking-wider">Unanswered Screening Question</span>
                    <div className="text-sm font-semibold text-white">{rev.question}</div>
                  </div>
                </div>

                {rev.job && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
                    <Briefcase className="w-3.5 h-3.5 text-indigo-400" />
                    <span>
                      {rev.job.title} @ <strong className="text-slate-200">{rev.job.employer}</strong>
                    </span>
                  </div>
                )}
              </div>

              {rev.context && (
                <div className="text-xs text-slate-400 bg-slate-950/60 p-2.5 rounded border border-slate-800 font-mono">
                  {rev.context}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Your Verified Answer:
                  </label>
                  <input
                    type="text"
                    placeholder="Enter answer as it should appear in the application form"
                    value={answers[rev.id] || ''}
                    onChange={(e) =>
                      setAnswers((prev) => ({ ...prev, [rev.id]: e.target.value }))
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={saveToBank[rev.id] ?? true}
                      onChange={(e) =>
                        setSaveToBank((prev) => ({ ...prev, [rev.id]: e.target.checked }))
                      }
                      className="w-4 h-4 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 bg-slate-950"
                    />
                    <span className="flex items-center gap-1">
                      <BookmarkPlus className="w-3.5 h-3.5 text-indigo-400" />
                      Save permanently to Pre-verified Answer Bank
                    </span>
                  </label>

                  <button
                    onClick={() => handleResolve(rev.id)}
                    disabled={resolvingId === rev.id || !answers[rev.id]?.trim()}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
                  >
                    {resolvingId === rev.id ? 'Submitting...' : 'Save & Resume Application'}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
