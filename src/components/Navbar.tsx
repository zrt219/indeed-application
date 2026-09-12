'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, ListOrdered, ShieldAlert, BookOpenCheck, UserCheck, Bot } from 'lucide-react';

export default function Navbar() {
  const pathname = usePathname();

  const links = [
    { href: '/', label: 'Overview', icon: LayoutDashboard },
    { href: '/queue', label: 'Queue & Worker', icon: ListOrdered },
    { href: '/manual-review', label: 'Manual Review', icon: ShieldAlert },
    { href: '/ledger', label: 'Event Ledger', icon: BookOpenCheck },
    { href: '/profile', label: 'Candidate Profile', icon: UserCheck },
  ];

  return (
    <header className="sticky top-0 z-50 bg-slate-900 border-b border-slate-800 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold shadow-md shadow-indigo-500/30">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <span className="font-semibold text-base tracking-tight text-white">ApplyAgent</span>
              <span className="ml-2 text-xs font-mono uppercase bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-2 py-0.5 rounded">Phi-3 ATS</span>
            </div>
          </div>

          <nav className="flex space-x-1 sm:space-x-2">
            {links.map((link) => {
              const Icon = link.icon;
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}
