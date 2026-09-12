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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-rose-50 text-rose-600 border border-rose-100">
              <ShieldAlert className="w-6 h-6" />
            </div>
            Manual Review & Human-in-the-Loop
          </h1>
          <p className="text-slate-600 text-sm font-medium mt-1">
            Strict anti-hallucination guardrails halt automation whenever facts are absent from the profile.
          </p>
        </div>

        <button
          onClick={() => {
            setLoading(true);
            fetchReviews();
          }}
          disabled={loading}
          className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold px-3.5 py-2.5 rounded-lg border border-slate-300 shadow-xs transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-600' : 'text-slate-600'}`} />
          Refresh Items
        </button>
      </div>

      {notification && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-lg text-xs font-semibold flex items-center gap-2 shadow-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          {notification}
        </div>
      )}

      {/* Questions list */}
      <div className="space-y-4">
        {reviews.length === 0 ? (
          <div className="bg-white border border-slate-200/90 rounded-xl p-10 text-center shadow-xs">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3 border border-emerald-100">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900">All Clear!</h3>
            <p className="text-xs font-medium text-slate-500 mt-1">
              There are no pending manual questions. The automated pipeline is operating without blocks.
            </p>
          </div>
        ) : (
          reviews.map((rev) => (
            <div
              key={rev.id}
              className="bg-white border border-slate-200/90 rounded-xl p-6 shadow-xs space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-3">
                  <span className="p-2 rounded-lg bg-rose-50 text-rose-600 border border-rose-100">
                    <HelpCircle className="w-5 h-5" />
                  </span>
                  <div>
                    <span className="text-[11px] font-mono font-bold text-rose-700 uppercase tracking-wider">Unanswered Screening Question</span>
                    <div className="text-base font-bold text-slate-900">{rev.question}</div>
                  </div>
                </div>

                {rev.job && (
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
                    <Briefcase className="w-3.5 h-3.5 text-indigo-600" />
                    <span>
                      {rev.job.title} @ <strong className="text-slate-900">{rev.job.employer}</strong>
                    </span>
                  </div>
                )}
              </div>

              {rev.context && (
                <div className="text-xs text-slate-800 bg-slate-50 p-3 rounded-lg border border-slate-200 font-mono">
                  {rev.context}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-800 uppercase tracking-wide mb-1.5">
                    Your Verified Answer:
                  </label>
                  <input
                    type="text"
                    placeholder="Enter answer as it should appear in the application form"
                    value={answers[rev.id] || ''}
                    onChange={(e) =>
                      setAnswers((prev) => ({ ...prev, [rev.id]: e.target.value }))
                    }
                    className="w-full bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 shadow-xs transition"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={saveToBank[rev.id] ?? true}
                      onChange={(e) =>
                        setSaveToBank((prev) => ({ ...prev, [rev.id]: e.target.checked }))
                      }
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="flex items-center gap-1.5">
                      <BookmarkPlus className="w-3.5 h-3.5 text-indigo-600" />
                      Save permanently to Pre-verified Answer Bank
                    </span>
                  </label>

                  <button
                    onClick={() => handleResolve(rev.id)}
                    disabled={resolvingId === rev.id || !answers[rev.id]?.trim()}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2.5 rounded-lg shadow-sm shadow-indigo-600/20 transition disabled:opacity-50"
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
