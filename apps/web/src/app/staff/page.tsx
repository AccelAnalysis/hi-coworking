"use client";

import { RequireAuth } from "@/components/RequireAuth";

export default function StaffDashboardPage() {
  return (
    <RequireAuth requiredRole="staff">
      <StaffDashboardContent />
    </RequireAuth>
  );
}

function StaffDashboardContent() {
  return (
    <div className="py-12">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Staff Portal</h1>
        <span className="bg-slate-100 text-slate-700 text-xs font-semibold px-2.5 py-0.5 rounded">Today View</span>
      </div>
      
      <div className="grid md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h3 className="font-bold text-slate-700 mb-4">Arrivals & Check-ins</h3>
          <div className="text-slate-500 text-sm italic">No arrivals scheduled for the next hour.</div>
        </div>
        
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h3 className="font-bold text-slate-700 mb-4">Room Resets</h3>
          <div className="text-slate-500 text-sm italic">Podcast Studio needs reset at 2:00 PM.</div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h3 className="font-bold text-slate-700 mb-4">Pending Approvals</h3>
          <div className="text-slate-500 text-sm italic">All clear.</div>
        </div>
      </div>
    </div>
  );
}
