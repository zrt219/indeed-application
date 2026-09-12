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
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100">
            <UserCheck className="w-6 h-6" />
          </div>
          Master Candidate Profile & Answer Bank
        </h1>
        <p className="text-slate-600 text-sm font-medium mt-1">
          Single source of truth for all deterministic qualification rules and anti-hallucination screening.
        </p>
      </div>

      {profile && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Personal Info & Work Auth */}
          <div className="space-y-6">
            <div className="bg-white border border-slate-200/90 rounded-xl p-5 shadow-xs space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-lg border border-indigo-200">
                  {profile.personal.fullName.charAt(0)}
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">{profile.personal.fullName}</h2>
                  <p className="text-xs text-indigo-600 font-bold">{profile.seniority} Engineer</p>
                </div>
              </div>

              <div className="space-y-2 text-xs text-slate-700 font-medium pt-3 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-slate-400" />
                  <span>
                    {profile.personal.location.city}, {profile.personal.location.state}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-slate-400" />
                  <span>{profile.yearsOfExperience} Years Experience</span>
                </div>
              </div>
            </div>

            {/* Work Auth */}
            <div className="bg-white border border-slate-200/90 rounded-xl p-5 shadow-xs space-y-3">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Work Authorization & Constraints
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">US Authorized</span>
                  <span className="text-emerald-700 font-bold">
                    {profile.workAuthorization.usAuthorized ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Requires Sponsorship</span>
                  <span className="text-slate-900 font-bold">
                    {profile.workAuthorization.requiresSponsorship ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Citizenship</span>
                  <span className="text-slate-900 font-bold">{profile.workAuthorization.citizenshipStatus}</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-slate-500 font-medium">Security Clearance</span>
                  <span className="text-slate-900 font-bold">{profile.workAuthorization.securityClearance}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Middle Column: Target Roles & Technical Skills */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white border border-slate-200/90 rounded-xl p-5 shadow-xs space-y-4">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                <Award className="w-4 h-4 text-indigo-600" />
                Target Roles & Keywords
              </h3>
              <div className="flex flex-wrap gap-2">
                {profile.targetRoles.map((role) => (
                  <span
                    key={role}
                    className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold px-3 py-1 rounded-md"
                  >
                    {role}
                  </span>
                ))}
              </div>
            </div>

            <div className="bg-white border border-slate-200/90 rounded-xl p-5 shadow-xs space-y-4">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                <Database className="w-4 h-4 text-indigo-600" />
                Core Technical Skills Matrix
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                {Object.entries(profile.skills).map(([category, items]) => (
                  <div key={category} className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-2.5">
                    <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                      {category}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {(items as string[]).map((skill) => (
                        <span key={skill} className="bg-white text-slate-800 border border-slate-300 font-semibold px-2 py-0.5 rounded text-[11px] shadow-2xs">
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
      <div className="bg-white border border-slate-200/90 rounded-xl overflow-hidden shadow-xs">
        <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Pre-Verified Answer Bank ({answerBank.length} Patterns)
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Deterministic answers applied with 100% confidence to eliminate LLM hallucinations.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-800">
            <thead className="bg-slate-100 text-slate-700 uppercase tracking-wider text-[11px] font-bold border-b border-slate-200">
              <tr>
                <th className="px-5 py-3.5">Category</th>
                <th className="px-5 py-3.5">Question Patterns</th>
                <th className="px-5 py-3.5">Deterministic Answer</th>
                <th className="px-5 py-3.5">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {answerBank.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50 transition">
                  <td className="px-5 py-3.5">
                    <span className="font-mono text-[11px] font-bold uppercase bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded">
                      {entry.category}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1.5">
                      {entry.patterns.map((pat) => (
                        <span key={pat} className="bg-slate-100 text-slate-800 font-medium px-2 py-0.5 rounded border border-slate-200 text-[11px]">
                          &ldquo;{pat}&rdquo;
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 font-bold text-emerald-700">{entry.answer}</td>
                  <td className="px-5 py-3.5 font-mono font-semibold text-slate-500">{Math.round(entry.confidence * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
