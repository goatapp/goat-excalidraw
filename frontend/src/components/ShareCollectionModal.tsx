import React, { useCallback, useEffect, useState, useRef } from "react";
import clsx from "clsx";
import {
  X,
  Plus,
  AlertTriangle,
  ChevronDown,
  Check,
  RefreshCw,
  Search,
} from "lucide-react";
import * as api from "../api";
import { useAuth } from "../context/AuthContext";
import type { CollectionShareRow, CollectionShareRole } from "../types";

type Props = {
  collectionId: string;
  collectionName: string;
  isOpen: boolean;
  onClose: () => void;
};

const CustomSelect: React.FC<{
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string; danger?: boolean }[];
  className?: string;
  align?: "left" | "right";
}> = ({ value, onChange, options, className, align = "left" }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const currentOption = options.find(o => o.value === value) || options[0];

  return (
    <div className={clsx("relative inline-flex items-center", className)} ref={containerRef}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all text-sm font-bold outline-none hover:bg-gray-100 dark:hover:bg-neutral-800 text-slate-700 dark:text-neutral-300"
      >
        <span>{currentOption.label}</span>
        <ChevronDown size={14} className={clsx("transition-transform duration-200", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className={clsx(
          "absolute top-full z-[100] mt-1.5 min-w-[140px] bg-white dark:bg-neutral-900 border-2 border-black dark:border-neutral-700 rounded-xl shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,0.1)] overflow-hidden animate-in fade-in zoom-in-95 duration-100",
          align === "right" ? "right-0" : "left-0"
        )}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange(opt.value);
                setIsOpen(false);
              }}
              className={clsx(
                "w-full text-left px-3 py-2 text-xs font-bold transition-colors flex items-center justify-between border-b last:border-b-0 border-slate-100 dark:border-neutral-800",
                opt.value === value
                  ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400"
                  : opt.danger
                    ? "text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                    : "text-slate-700 dark:text-neutral-300 hover:bg-slate-50 dark:hover:bg-neutral-800"
              )}
            >
              {opt.label}
              {opt.value === value && <Check size={12} strokeWidth={3} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const ShareCollectionModal: React.FC<Props> = ({ collectionId, collectionName, isOpen, onClose }) => {
  const { user } = useAuth();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shares, setShares] = useState<CollectionShareRow[]>([]);

  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<api.ShareResolvedUser[]>([]);
  const [userRole, setUserRole] = useState<CollectionShareRole>("view");

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getCollectionShares(collectionId);
      setShares(data.shares);
    } catch (err: unknown) {
      let message = "Failed to load sharing settings";
      if (api.isAxiosError(err)) {
        const serverMessage = typeof err.response?.data?.message === "string" ? err.response.data.message : null;
        if (serverMessage) message = serverMessage;
      }
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [collectionId]);

  useEffect(() => {
    if (!isOpen) return;
    setUserQuery("");
    setUserResults([]);
    setUserRole("view");
    void refresh();
  }, [isOpen, refresh]);

  useEffect(() => {
    if (!isOpen) return;
    const q = userQuery.trim();
    if (q.length < 3) {
      setUserResults([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const users = await api.resolveCollectionShareUsers(collectionId, q);
        if (!cancelled) setUserResults(users);
      } catch {
        if (!cancelled) setUserResults([]);
      }
    };
    const t = window.setTimeout(run, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [collectionId, isOpen, userQuery]);

  const handleAddUser = async (uId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await api.addCollectionShare(collectionId, { granteeUserId: uId, role: userRole });
      await refresh();
      setUserQuery("");
      setUserResults([]);
    } catch (err: unknown) {
      let message = "Failed to share with user";
      if (api.isAxiosError(err)) {
        const serverMessage = typeof err.response?.data?.message === "string" ? err.response.data.message : null;
        if (serverMessage) message = serverMessage;
      }
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevokeUser = async (userId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await api.removeCollectionShare(collectionId, userId);
      await refresh();
    } catch {
      setError("Failed to revoke access");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateRole = async (userId: string, role: CollectionShareRole) => {
    setIsLoading(true);
    setError(null);
    try {
      await api.updateCollectionShare(collectionId, userId, { role });
      await refresh();
    } catch {
      setError("Failed to update role");
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-[420px] bg-white dark:bg-neutral-900 rounded-[20px] border-2 border-black dark:border-neutral-700 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.05)] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="px-5 py-3.5 flex items-center justify-between border-b-2 border-black dark:border-neutral-700">
          <h2 className="text-base font-black text-slate-800 dark:text-neutral-100 truncate pr-4" title={collectionName}>
            Share "{collectionName}"
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg border-2 border-transparent hover:border-black dark:hover:border-neutral-600 transition-all group shrink-0"
          >
            <X size={16} strokeWidth={3} className="group-hover:rotate-90 transition-transform duration-200" />
          </button>
        </div>

        <div className="flex-1 px-5 py-5 space-y-5 overflow-visible">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-900/20 border-2 border-rose-600 dark:border-rose-500 text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-3">
              <AlertTriangle size={16} strokeWidth={3} />
              {error}
            </div>
          )}

          <section className="relative">
            <div className="relative group">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors">
                <Search size={16} strokeWidth={2.5} />
              </div>
              <input
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                placeholder="Add people"
                className="w-full pl-10 pr-4 py-2 rounded-xl border-2 border-black dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800 text-slate-900 dark:text-neutral-100 focus:outline-none focus:ring-0 focus:border-indigo-600 dark:focus:border-indigo-500 transition-all text-sm font-bold placeholder:text-slate-400 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.05)]"
              />
            </div>

            {userResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-2 border-2 border-black dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-900 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.1)] overflow-hidden z-[200] animate-in fade-in slide-in-from-top-2">
                {userResults.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => handleAddUser(u.id)}
                    className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors group border-b last:border-b-0 border-slate-100 dark:border-neutral-800"
                  >
                    <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-black text-xs border-2 border-black dark:border-neutral-600">
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-black text-slate-900 dark:text-neutral-100 truncate">{u.name}</div>
                      <div className="text-[10px] font-bold text-slate-500 dark:text-neutral-400 truncate">{u.email}</div>
                    </div>
                    <Plus size={16} className="text-slate-400 group-hover:text-indigo-600 transition-colors" strokeWidth={3} />
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-neutral-500 px-1">People with access</h3>

            <div className="space-y-0">
              <div className="flex items-center gap-3 px-1 py-1.5">
                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-neutral-800 flex items-center justify-center text-slate-600 dark:text-neutral-300 font-black text-sm border-2 border-black dark:border-neutral-600 shrink-0">
                  {user?.name?.charAt(0).toUpperCase() || "U"}
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <div className="text-xs font-black text-slate-900 dark:text-neutral-100 leading-tight">
                    {user?.name} <span className="text-slate-400 dark:text-neutral-500 font-bold ml-1">(you)</span>
                  </div>
                  <div className="text-[10px] font-bold text-slate-500 dark:text-neutral-400 mt-0.5">{user?.email}</div>
                </div>
                <div className="text-[8px] font-black uppercase tracking-widest text-slate-400 dark:text-neutral-500 pr-1 shrink-0">Owner</div>
              </div>

              {shares.map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-1 py-1.5 group">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-black text-sm border-2 border-indigo-600 dark:border-indigo-500 shrink-0">
                    {s.granteeUser.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <div className="text-xs font-black text-slate-900 dark:text-neutral-100 leading-tight truncate">{s.granteeUser.name}</div>
                    <div className="text-[10px] font-bold text-slate-500 dark:text-neutral-400 mt-0.5 truncate">{s.granteeUser.email}</div>
                  </div>
                  <div className="shrink-0 flex items-center h-full">
                    <CustomSelect
                      value={s.role}
                      onChange={async (val) => {
                        if (val === "remove") {
                          await handleRevokeUser(s.granteeUserId);
                        } else {
                          await handleUpdateRole(s.granteeUserId, val as CollectionShareRole);
                        }
                      }}
                      options={[
                        { label: "Viewer", value: "view" },
                        { label: "Editor", value: "edit" },
                        { label: "Remove access", value: "remove", danger: true },
                      ]}
                      align="right"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="px-5 py-5 flex items-center justify-end border-t-2 border-black dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800/50 rounded-b-[18px]">
          <button
            onClick={onClose}
            className="px-8 py-2.5 rounded-xl bg-indigo-600 dark:bg-indigo-500 text-white border-2 border-black font-black text-[10px] uppercase tracking-[0.2em] hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-y-0 active:shadow-none transition-all shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
          >
            DONE
          </button>
        </div>

        {isLoading && (
          <div className="absolute inset-0 bg-white/20 dark:bg-black/10 backdrop-blur-[1px] flex items-center justify-center z-[300] pointer-events-none rounded-[24px]">
            <div className="bg-white dark:bg-neutral-900 border-2 border-black dark:border-neutral-700 p-5 rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
              <RefreshCw size={28} strokeWidth={3} className="animate-spin text-indigo-600 dark:text-indigo-400" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
