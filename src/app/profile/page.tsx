'use client';

import { useState, useEffect } from 'react';
import { UserCheck, ShieldCheck, Database, Award, MapPin, Briefcase } from 'lucide-react';
import { CandidateProfile } from '@/qualification/engine';
import { AnswerBankEntry } from '@/llm/ollama';

export default function ProfilePage() {
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [answerBank, setAnswerBank] = useState<AnswerBankEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/profile')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setProfile(data.data.profile);
          setAnswerBank(data.data.answerBank);
        }
      })
      .catch((err) => console.error('Failed to load profile:', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-8 text-center text-slate-400 text-xs">Loading Candidate Profile...</div>;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="border-b border-slate-800 pb-5">
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <UserCheck className="w-6 h-6 text-indigo-400" />
          Master Candidate Profile & Answer Bank
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Single source of truth for all deterministic qualification rules and anti-hallucination screening.
        </p>
      </div>

      {profile && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Personal Info & Work Auth */}
          <div className="space-y-6">
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold text-lg border border-indigo-500/30">
                  {profile.personal.fullName.charAt(0)}
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">{profile.personal.fullName}</h2>
                  <p className="text-xs text-indigo-400 font-medium">{profile.seniority} Engineer</p>
                </div>
              </div>

              <div className="space-y-2 text-xs text-slate-300 pt-2 border-t border-slate-800">
                <div className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-slate-500" />
                  <span>
                    {profile.personal.location.city}, {profile.personal.location.state}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Briefcase className="w-3.5 h-3.5 text-slate-500" />
                  <span>{profile.yearsOfExperience} Years Experience</span>
                </div>
              </div>
            </div>

            {/* Work Auth */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Work Authorization & Constraints
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">US Authorized</span>
                  <span className="text-emerald-400 font-medium">
                    {profile.workAuthorization.usAuthorized ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Requires Sponsorship</span>
                  <span className="text-slate-200 font-medium">
                    {profile.workAuthorization.requiresSponsorship ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Citizenship</span>
                  <span className="text-slate-200 font-medium">{profile.workAuthorization.citizenshipStatus}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400">Security Clearance</span>
                  <span className="text-slate-200 font-medium">{profile.workAuthorization.securityClearance}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Middle Column: Target Roles & Technical Skills */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <Award className="w-4 h-4 text-indigo-400" />
                Target Roles & Keywords
              </h3>
              <div className="flex flex-wrap gap-2">
                {profile.targetRoles.map((role) => (
                  <span
                    key={role}
                    className="text-xs bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-2.5 py-1 rounded-md"
                  >
                    {role}
                  </span>
                ))}
              </div>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <Database className="w-4 h-4 text-indigo-400" />
                Core Technical Skills Matrix
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                {Object.entries(profile.skills).map(([category, items]) => (
                  <div key={category} className="bg-slate-950/60 p-3 rounded-lg border border-slate-800 space-y-2">
                    <span className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">
                      {category}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {(items as string[]).map((skill) => (
                        <span key={skill} className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[11px]">
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pre-Verified Answer Bank */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-5 border-b border-slate-800 flex justify-between items-center">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Pre-Verified Answer Bank ({answerBank.length} Patterns)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Deterministic answers applied with 100% confidence to eliminate LLM hallucinations.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
              <tr>
                <th className="px-5 py-3">Category</th>
                <th className="px-5 py-3">Question Patterns</th>
                <th className="px-5 py-3">Deterministic Answer</th>
                <th className="px-5 py-3">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {answerBank.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-800/30 transition">
                  <td className="px-5 py-3">
                    <span className="font-mono text-[10px] uppercase bg-slate-800 text-indigo-400 px-2 py-0.5 rounded">
                      {entry.category}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {entry.patterns.map((pat) => (
                        <span key={pat} className="bg-slate-950 text-slate-300 px-2 py-0.5 rounded border border-slate-800 text-[11px]">
                          &ldquo;{pat}&rdquo;
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3 font-medium text-emerald-400">{entry.answer}</td>
                  <td className="px-5 py-3 font-mono text-slate-400">{Math.round(entry.confidence * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
