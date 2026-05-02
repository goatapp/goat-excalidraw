import React from 'react';
import { BarChart3, Users, FileImage, FolderOpen, History, HardDrive, RefreshCw } from 'lucide-react';

type TopCollection = {
  collectionId: string | null;
  collectionName: string;
  drawingCount: number;
};

type AdminStats = {
  totalDrawings: number;
  totalUsers: number;
  activeUsers7d: number;
  activeUsers30d: number;
  totalCollections: number;
  totalSnapshots: number;
  drawingStorageBytes: number;
  snapshotStorageBytes: number;
  topCollections: TopCollection[];
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
};

type AnalyticsCardProps = {
  stats: AdminStats | null;
  loading: boolean;
  onRefresh: () => void | Promise<void>;
};

const StatTile: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
}> = ({ icon, label, value, sub }) => (
  <div className="flex items-start gap-3 p-4 rounded-xl border-2 border-slate-200 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800/50">
    <div className="mt-0.5 text-slate-500 dark:text-neutral-400">{icon}</div>
    <div className="min-w-0">
      <div className="text-2xl font-bold text-slate-900 dark:text-white">{value}</div>
      <div className="text-sm font-medium text-slate-600 dark:text-neutral-400">{label}</div>
      {sub && <div className="text-xs text-slate-500 dark:text-neutral-500 mt-0.5">{sub}</div>}
    </div>
  </div>
);

export const AnalyticsCard: React.FC<AnalyticsCardProps> = ({ stats, loading, onRefresh }) => (
  <div className="mb-6 bg-white dark:bg-neutral-900 border-2 border-black dark:border-neutral-700 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] p-4 sm:p-6">
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-violet-50 dark:bg-neutral-800 rounded-xl flex items-center justify-center border-2 border-violet-100 dark:border-neutral-700">
          <BarChart3 size={24} className="text-violet-600 dark:text-violet-400" />
        </div>
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Analytics</h2>
          <p className="text-sm text-slate-600 dark:text-neutral-400 font-medium">
            Usage overview
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void onRefresh()}
        disabled={loading}
        className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-neutral-800 text-slate-500 dark:text-neutral-400 transition-colors disabled:opacity-50"
        title="Refresh stats"
      >
        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
      </button>
    </div>

    {loading && !stats ? (
      <div className="text-sm text-slate-500 dark:text-neutral-400 py-8 text-center">Loading stats...</div>
    ) : stats ? (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          <StatTile
            icon={<FileImage size={20} />}
            label="Drawings"
            value={stats.totalDrawings}
          />
          <StatTile
            icon={<Users size={20} />}
            label="Total users"
            value={stats.totalUsers}
            sub={`${stats.activeUsers7d} active (7d) / ${stats.activeUsers30d} (30d)`}
          />
          <StatTile
            icon={<FolderOpen size={20} />}
            label="Collections"
            value={stats.totalCollections}
          />
          <StatTile
            icon={<HardDrive size={20} />}
            label="Storage"
            value={formatBytes(stats.drawingStorageBytes + stats.snapshotStorageBytes)}
            sub={`Drawings ${formatBytes(stats.drawingStorageBytes)} / Snapshots ${formatBytes(stats.snapshotStorageBytes)}`}
          />
          <StatTile
            icon={<History size={20} />}
            label="Snapshots"
            value={stats.totalSnapshots}
          />
        </div>

        {stats.topCollections.length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-slate-700 dark:text-neutral-300 mb-2">
              Top collections by drawing count
            </h3>
            <div className="space-y-1">
              {stats.topCollections.map((c, i) => {
                const maxCount = stats.topCollections[0]?.drawingCount || 1;
                const pct = Math.round((c.drawingCount / maxCount) * 100);
                return (
                  <div key={c.collectionId ?? `uncategorized-${i}`} className="flex items-center gap-3 text-sm">
                    <span className="w-36 truncate text-slate-700 dark:text-neutral-300 font-medium">
                      {c.collectionName}
                    </span>
                    <div className="flex-1 h-5 bg-slate-100 dark:bg-neutral-800 rounded-md overflow-hidden">
                      <div
                        className="h-full bg-violet-400 dark:bg-violet-600 rounded-md transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-slate-600 dark:text-neutral-400 tabular-nums">
                      {c.drawingCount}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </>
    ) : (
      <div className="text-sm text-slate-500 dark:text-neutral-400 py-8 text-center">
        Failed to load stats
      </div>
    )}
  </div>
);
