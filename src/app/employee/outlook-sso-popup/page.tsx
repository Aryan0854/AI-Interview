"use client";

import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function OutlookSSOPopup() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  const mockAccounts = [
    { name: "Sofia Reddy", email: "sofia.reddy@example.com" },
    { name: "Guest Developer", email: "guest.developer@outlook.com" }
  ];

  const handleSelectAccount = (selectedEmail: string) => {
    if (typeof window !== "undefined" && window.opener) {
      window.opener.postMessage(
        { type: "outlook-sso-success", email: selectedEmail },
        window.location.origin
      );
      window.close();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      setError("Enter a valid email address, phone number, or Skype name.");
      return;
    }

    handleSelectAccount(email.trim());
  };

  return (
    <div className="min-h-screen bg-[#f3f3f3] flex items-center justify-center font-sans px-4 py-8">
      <div className="w-full max-w-[440px] bg-white border border-[#cccccc] shadow-lg p-11 flex flex-col space-y-6">
        
        {/* Microsoft Logo */}
        <div className="flex items-center gap-2">
          <svg className="w-[36px] h-[36px]" viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 0H11V11H0V0Z" fill="#F25022"/>
            <path d="M12 0H23V11H12V0Z" fill="#7FBA00"/>
            <path d="M0 12H11V23H0V12Z" fill="#00A4EF"/>
            <path d="M12 12H23V23H12V12Z" fill="#FFB900"/>
          </svg>
          <span className="text-[20px] font-semibold text-[#737373]">Microsoft</span>
        </div>

        {/* Form Details */}
        <div className="space-y-4">
          <h1 className="text-[24px] font-semibold text-[#1b1b1b] tracking-tight">Sign in</h1>
          <p className="text-xs text-[#505050]">to continue to your Employee Learning & Assessment Portal</p>
        </div>

        {error && (
          <div className="text-xs text-[#e81123] font-medium leading-relaxed">
            {error}
          </div>
        )}

        {/* Seeded Accounts selection */}
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#737373]">Pick an active employee profile</p>
          <div className="space-y-2.5">
            {mockAccounts.map((acc, idx) => (
              <button
                key={idx}
                onClick={() => handleSelectAccount(acc.email)}
                className="w-full text-left p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-[#e5e5e5] rounded-lg transition flex items-center justify-between group"
              >
                <div>
                  <p className="text-xs font-bold text-[#1b1b1b]">{acc.name}</p>
                  <p className="text-[10px] text-[#505050] font-semibold">{acc.email}</p>
                </div>
                <Badge className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold text-[9px] border-0 px-2 py-0.5 group-hover:scale-105 transition">
                  Quick Log In
                </Badge>
              </button>
            ))}
          </div>
        </div>

        <div className="relative flex items-center justify-center my-3">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#cccccc]"></div></div>
          <span className="relative px-3 text-[10px] font-bold text-[#737373] bg-white uppercase tracking-wider">Or Use Other Email</span>
        </div>

        {/* Custom Input */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(""); }}
            placeholder="Email, phone, or Skype"
            className="w-full text-sm py-2 px-0 border-b border-[#666666] focus:border-[#0067b8] outline-none text-[#1b1b1b] placeholder:text-[#666666] transition font-medium"
          />

          <div className="flex justify-between items-center text-xs text-[#0067b8] font-semibold">
            <span className="cursor-pointer hover:underline">Can&apos;t access your account?</span>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="submit"
              className="bg-[#0067b8] hover:bg-[#005da6] text-white text-xs font-semibold px-6 py-2 rounded-none transition shadow-sm h-9"
            >
              Next
            </Button>
          </div>
        </form>

      </div>
    </div>
  );
}
