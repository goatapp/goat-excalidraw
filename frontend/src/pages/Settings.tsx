import React, { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { useNavigate } from 'react-router-dom';
import * as api from '../api';
import type { Collection } from '../types';
import { Upload, Moon, Sun, Info, Archive, Zap, ZapOff } from 'lucide-react';
import { ConfirmModal } from '../components/ConfirmModal';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';

export const Settings: React.FC = () => {
    const [collections, setCollections] = useState<Collection[]>([]);
    const navigate = useNavigate();
    const { theme, toggleTheme } = useTheme();
    const { authEnabled, user, authMode } = useAuth();

    const [authToggleLoading, setAuthToggleLoading] = useState(false);
    const [authToggleError, setAuthToggleError] = useState<string | null>(null);
    const [authToggleConfirm, setAuthToggleConfirm] = useState<{ isOpen: boolean; nextEnabled: boolean | null }>({
        isOpen: false,
        nextEnabled: null,
    });
    const [authDisableFinalConfirmOpen, setAuthDisableFinalConfirmOpen] = useState(false);

    const [backupExportExt, setBackupExportExt] = useState<'excalidash' | 'excalidash.zip'>('excalidash');
    const [backupImportConfirmation, setBackupImportConfirmation] = useState<{
        isOpen: boolean;
        file: File | null;
        info: null | {
            formatVersion: number;
            exportedAt: string;
            excalidashBackendVersion: string | null;
            collections: number;
            drawings: number;
        };
    }>({ isOpen: false, file: null, info: null });
    const [backupImportLoading, setBackupImportLoading] = useState(false);
    const [backupImportSuccess, setBackupImportSuccess] = useState(false);
    const [backupImportError, setBackupImportError] = useState<{ isOpen: boolean; message: string }>({ isOpen: false, message: '' });

    const isManagedAuthMode = authMode !== 'local';


    useEffect(() => {
        const fetchCollections = async () => {
            try {
                const data = await api.getCollections();
                setCollections(data);
            } catch (err) {
                console.error('Failed to fetch collections:', err);
            }
        };
        fetchCollections();
    }, []);

    const COMPRESSION_ENABLED_KEY = 'excalidash-image-compression';
    const [imageCompression, setImageCompression] = useState<boolean>(() => {
        const raw = typeof window === 'undefined' ? null : window.localStorage?.getItem?.(COMPRESSION_ENABLED_KEY);
        return raw !== 'false';
    });

    const toggleImageCompression = () => {
        const next = !imageCompression;
        try {
            window.localStorage?.setItem?.(COMPRESSION_ENABLED_KEY, String(next));
        } catch { /* storage unavailable */ }
        setImageCompression(next);
    };

    const setAuthEnabled = async (enabled: boolean) => {
        setAuthToggleLoading(true);
        setAuthToggleError(null);
        try {
            const response = await api.api.post<{ authEnabled: boolean; bootstrapRequired?: boolean }>(
                '/auth/auth-enabled',
                { enabled },
            );

            if (response.data.authEnabled) {
                window.location.href = response.data.bootstrapRequired ? '/register' : '/login';
                return;
            }

            window.location.reload();
        } catch (err: unknown) {
            let message = 'Failed to update authentication setting';
            if (api.isAxiosError(err)) {
                message =
                    err.response?.data?.message ||
                    err.response?.data?.error ||
                    message;
            }
            setAuthToggleError(message);
        } finally {
            setAuthToggleLoading(false);
        }
    };

    const confirmToggleAuthEnabled = () => {
        if (authEnabled === null) return;
        if (authToggleLoading) return;
        setAuthToggleConfirm({ isOpen: true, nextEnabled: !authEnabled });
    };

    const exportBackup = async () => {
        try {
            const extQuery = backupExportExt === 'excalidash.zip' ? '?ext=zip' : '';
            const response = await api.api.get(`/export/excalidash${extQuery}`, { responseType: 'blob' });
            const blob = new Blob([response.data], { type: 'application/zip' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            const date = new Date().toISOString().split('T')[0];
            link.download = backupExportExt === 'excalidash.zip'
                ? `excalidash-backup-${date}.excalidash.zip`
                : `excalidash-backup-${date}.excalidash`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (err: unknown) {
            console.error('Backup export failed:', err);
            setBackupImportError({ isOpen: true, message: 'Failed to export backup. Please try again.' });
        }
    };

    const verifyBackupFile = async (file: File) => {
        setBackupImportLoading(true);
        try {
            const formData = new FormData();
            formData.append('archive', file);
            const response = await api.api.post<{
                valid: boolean;
                formatVersion: number;
                exportedAt: string;
                excalidashBackendVersion: string | null;
                collections: number;
                drawings: number;
            }>('/import/excalidash/verify', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });

            setBackupImportConfirmation({
                isOpen: true,
                file,
                info: {
                    formatVersion: response.data.formatVersion,
                    exportedAt: response.data.exportedAt,
                    excalidashBackendVersion: response.data.excalidashBackendVersion ?? null,
                    collections: response.data.collections,
                    drawings: response.data.drawings,
                },
            });
        } catch (err: unknown) {
            console.error('Backup verify failed:', err);
            let message = 'Failed to verify backup file.';
            if (api.isAxiosError(err)) {
                message = err.response?.data?.message || err.response?.data?.error || message;
            }
            setBackupImportError({ isOpen: true, message });
        } finally {
            setBackupImportLoading(false);
        }
    };

    const handleCreateCollection = async (name: string) => {
        await api.createCollection(name);
        const newCollections = await api.getCollections();
        setCollections(newCollections);
    };

    const handleEditCollection = async (id: string, name: string) => {
        setCollections(prev => prev.map(c => c.id === id ? { ...c, name } : c));
        await api.updateCollection(id, name);
    };

    const handleDeleteCollection = async (id: string) => {
        setCollections(prev => prev.filter(c => c.id !== id));
        await api.deleteCollection(id);
    };

    const handleSelectCollection = (id: string | null | undefined) => {
        if (id === undefined) navigate('/');
        else if (id === null) navigate('/collections?id=unorganized');
        else navigate(`/collections?id=${id}`);
    };



    return (
        <Layout
            collections={collections}
            selectedCollectionId="SETTINGS"
            onSelectCollection={handleSelectCollection}
            onCreateCollection={handleCreateCollection}
            onEditCollection={handleEditCollection}
            onDeleteCollection={handleDeleteCollection}
        >
            <h1 className="text-3xl sm:text-4xl lg:text-5xl mb-6 lg:mb-8 text-slate-900 dark:text-white pl-1" style={{ fontFamily: 'Excalifont' }}>
                Settings
            </h1>

            {authToggleError && (
                <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-xl">
                    <p className="text-red-800 dark:text-red-200 font-medium">{authToggleError}</p>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                <div className="flex flex-col items-center justify-center gap-3 sm:gap-4 p-4 sm:p-6 lg:p-8 bg-white dark:bg-neutral-900 border-2 border-black dark:border-neutral-700 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)]">
                    <div className="w-12 h-12 sm:w-16 sm:h-16 bg-indigo-50 dark:bg-neutral-800 rounded-2xl flex items-center justify-center border-2 border-indigo-100 dark:border-neutral-700">
                        <Archive size={32} className="text-indigo-600 dark:text-indigo-400 hidden sm:block" />
                        <Archive size={24} className="text-indigo-600 dark:text-indigo-400 sm:hidden" />
                    </div>
                    <div className="text-center">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Export Backup</h3>
                        <p className="text-xs text-slate-500 dark:text-neutral-400 font-medium max-w-[200px] mx-auto">
                            Exports an `.excalidash` archive organized by collections
                        </p>
                    </div>
                    <div className="w-full flex flex-col items-stretch gap-2 pt-2">
                        <button
                            onClick={exportBackup}
                            className="w-full px-4 py-2 text-sm font-bold rounded-xl border-2 border-black dark:border-neutral-700 bg-indigo-600 text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 transition-all"
                        >
                            Export
                        </button>
                        <select
                            value={backupExportExt}
                            onChange={(e) => setBackupExportExt(e.target.value as any)}
                            className="w-full px-3 py-2 text-sm font-bold rounded-xl border-2 border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-slate-900 dark:text-white"
                            title="Download name"
                        >
                            <option value="excalidash">.excalidash</option>
                            <option value="excalidash.zip">.excalidash.zip</option>
                        </select>
                    </div>
                </div>

                <button
                    onClick={toggleTheme}
                    className="w-full flex flex-col items-center justify-center gap-3 sm:gap-4 p-4 sm:p-6 lg:p-8 bg-white dark:bg-neutral-900 border-2 border-black dark:border-neutral-700 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.2)] hover:-translate-y-1 transition-all duration-200 group"
                >
                    <div className="w-12 h-12 sm:w-16 sm:h-16 bg-amber-50 dark:bg-neutral-800 rounded-2xl flex items-center justify-center border-2 border-amber-100 dark:border-neutral-700 group-hover:border-amber-200 dark:group-hover:border-neutral-600 transition-colors">
                        {theme === 'light' ? (
                            <Moon size={32} className="text-amber-600 dark:text-amber-400 hidden sm:block" />
                        ) : (
                            <Sun size={32} className="text-amber-600 dark:text-amber-400 hidden sm:block" />
                        )}
                        {theme === 'light' ? (
                            <Moon size={24} className="text-amber-600 dark:text-amber-400 sm:hidden" />
                        ) : (
                            <Sun size={24} className="text-amber-600 dark:text-amber-400 sm:hidden" />
                        )}
                    </div>
                    <div className="text-center">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
                            {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-neutral-400 font-medium max-w-[200px] mx-auto">
                            Switch to {theme === 'light' ? 'dark' : 'light'} theme
                        </p>
                    </div>
                </button>

                <button
                    onClick={toggleImageCompression}
                    className="w-full flex flex-col items-center justify-center gap-3 sm:gap-4 p-4 sm:p-6 lg:p-8 bg-white dark:bg-neutral-900 border-2 border-black dark:border-neutral-700 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.2)] hover:-translate-y-1 transition-all duration-200 group"
                >
                    <div className="w-12 h-12 sm:w-16 sm:h-16 bg-blue-50 dark:bg-neutral-800 rounded-2xl flex items-center justify-center border-2 border-blue-100 dark:border-neutral-700 group-hover:border-blue-200 dark:group-hover:border-neutral-600 transition-colors">
                        {imageCompression ? (
                            <Zap size={32} className="text-blue-600 dark:text-blue-400 hidden sm:block" />
                        ) : (
                            <ZapOff size={32} className="text-blue-600 dark:text-blue-400 hidden sm:block" />
                        )}
                        {imageCompression ? (
                            <Zap size={24} className="text-blue-600 dark:text-blue-400 sm:hidden" />
                        ) : (
                            <ZapOff size={24} className="text-blue-600 dark:text-blue-400 sm:hidden" />
                        )}
                    </div>
                    <div className="text-center">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
                            {imageCompression ? 'Optimized Images' : 'Raw Images'}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-neutral-400 font-medium max-w-[200px] mx-auto">
                            {imageCompression ? 'Lossy compression enabled' : 'Lossless (high bandwidth) enabled'}
                        </p>
                    </div>
                </button>

            </div>

            <details className="mt-8 bg-white/30 dark:bg-neutral-900/30 border border-slate-200/70 dark:border-neutral-800/70 rounded-2xl p-4 sm:p-6">
                <summary className="cursor-pointer select-none font-bold text-slate-800 dark:text-neutral-200">
                    Advanced / Legacy
                </summary>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                    <div className="relative">
                        <input
                            type="file"
                            accept=".excalidash,.zip"
                            className="hidden"
                            id="settings-import-backup"
                            onChange={async (e) => {
                                const file = (e.target.files || [])[0];
                                if (!file) return;
                                await verifyBackupFile(file);
                                e.target.value = '';
                            }}
                        />
                        <button
                            onClick={() => document.getElementById('settings-import-backup')?.click()}
                            disabled={backupImportLoading}
                            className="w-full h-full flex flex-col items-center justify-center gap-3 sm:gap-4 p-4 sm:p-6 lg:p-8 bg-white dark:bg-neutral-900 border-2 border-black dark:border-neutral-700 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.2)] hover:-translate-y-1 transition-all duration-200 group disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-blue-50 dark:bg-neutral-800 rounded-2xl flex items-center justify-center border-2 border-blue-100 dark:border-neutral-700">
                                <Upload size={32} className="text-blue-600 dark:text-blue-400 hidden sm:block" />
                                <Upload size={24} className="text-blue-600 dark:text-blue-400 sm:hidden" />
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
                                    {backupImportLoading ? 'Verifying…' : 'Import Backup'}
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-neutral-400 font-medium max-w-[200px] mx-auto">
                                    Merge-import a `.excalidash` backup into your account
                                </p>
                            </div>
                        </button>
                    </div>

                    <button
                        onClick={confirmToggleAuthEnabled}
                        disabled={
                            isManagedAuthMode ||
                            authEnabled === null ||
                            authToggleLoading ||
                            (authEnabled === true && user?.role !== 'ADMIN')
                        }
                        className="w-full flex flex-col items-center justify-center gap-3 sm:gap-4 p-4 sm:p-6 lg:p-8 bg-white dark:bg-neutral-900 border-2 border-black dark:border-neutral-700 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.2)] hover:-translate-y-1 transition-all duration-200 group disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:hover:translate-y-0"
                    >
                        <div className="w-12 h-12 sm:w-16 sm:h-16 bg-slate-50 dark:bg-neutral-800 rounded-2xl flex items-center justify-center border-2 border-slate-200 dark:border-neutral-700 group-hover:border-slate-300 dark:group-hover:border-neutral-600 transition-colors">
                            <Info size={32} className="text-slate-700 dark:text-neutral-300 hidden sm:block" />
                            <Info size={24} className="text-slate-700 dark:text-neutral-300 sm:hidden" />
                        </div>
                        <div className="text-center">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
                                {authEnabled ? 'Authentication: On' : 'Authentication: Off'}
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-neutral-400 font-medium max-w-[200px] mx-auto">
                                {isManagedAuthMode
                                    ? `Managed by AUTH_MODE=${authMode}`
                                    : authEnabled
                                        ? user?.role === 'ADMIN'
                                            ? (authToggleLoading ? 'Disabling…' : 'Disable multi-user login')
                                            : 'Only admins can disable'
                                        : authToggleLoading
                                            ? 'Enabling…'
                                            : 'Enable multi-user login'}
                            </p>
                        </div>
                    </button>

                </div>
            </details>

            <ConfirmModal
                isOpen={authToggleConfirm.isOpen}
                title={authToggleConfirm.nextEnabled ? 'Enable authentication?' : 'Disable authentication?'}
                message={
                    authToggleConfirm.nextEnabled
                        ? 'This will require users to sign in. You will be prompted to set up an admin account immediately.'
                        : (
                            <div className="space-y-2 text-left">
                                <div>
                                    This will turn off authentication for the entire instance.
                                </div>
                                <div className="font-semibold text-rose-700 dark:text-rose-300">
                                    Recommendation: keep authentication enabled unless this instance is fully private.
                                </div>
                            </div>
                        )
                }
                confirmText={authToggleConfirm.nextEnabled ? 'Enable' : 'Continue'}
                cancelText="Cancel"
                isDangerous={!authToggleConfirm.nextEnabled}
                onConfirm={async () => {
                    const nextEnabled = authToggleConfirm.nextEnabled;
                    setAuthToggleConfirm({ isOpen: false, nextEnabled: null });
                    if (typeof nextEnabled !== 'boolean') return;
                    if (!nextEnabled) {
                        setAuthDisableFinalConfirmOpen(true);
                        return;
                    }
                    await setAuthEnabled(nextEnabled);
                }}
                onCancel={() => setAuthToggleConfirm({ isOpen: false, nextEnabled: null })}
            />

            <ConfirmModal
                isOpen={authDisableFinalConfirmOpen}
                title="Final warning: disable authentication?"
                message={
                    <div className="space-y-2 text-left">
                        <div>
                            With authentication off, any user who can access this URL can view and modify all drawings and settings. They can also turn authentication back on and lock you out.
                        </div>
                        <div className="font-semibold text-rose-700 dark:text-rose-300">
                            This is only safe on a trusted private network.
                        </div>
                    </div>
                }
                confirmText="Disable Authentication"
                cancelText="Keep Enabled (Recommended)"
                isDangerous
                onConfirm={async () => {
                    setAuthDisableFinalConfirmOpen(false);
                    await setAuthEnabled(false);
                }}
                onCancel={() => setAuthDisableFinalConfirmOpen(false)}
            />

            <ConfirmModal
                isOpen={backupImportConfirmation.isOpen}
                title="Import backup?"
                message={
                    backupImportConfirmation.info
                        ? `This will merge ${backupImportConfirmation.info.collections} collection(s) and ${backupImportConfirmation.info.drawings} drawing(s) from a Format v${backupImportConfirmation.info.formatVersion} backup exported at ${backupImportConfirmation.info.exportedAt}.`
                        : 'This will merge the backup into your account.'
                }
                confirmText="Import"
                cancelText="Cancel"
                isDangerous={false}
                onConfirm={async () => {
                    const file = backupImportConfirmation.file;
                    if (!file) return;
                    setBackupImportConfirmation({ ...backupImportConfirmation, isOpen: false });
                    setBackupImportLoading(true);
                    try {
                        const formData = new FormData();
                        formData.append('archive', file);
                        await api.api.post('/import/excalidash', formData, {
                            headers: { 'Content-Type': 'multipart/form-data' },
                        });
                        setBackupImportConfirmation({ isOpen: false, file: null, info: null });
                        setBackupImportSuccess(true);
                    } catch (err: unknown) {
                        console.error('Backup import failed:', err);
                        let message = 'Failed to import backup.';
                        if (api.isAxiosError(err)) {
                            message = err.response?.data?.message || err.response?.data?.error || message;
                        }
                        setBackupImportError({ isOpen: true, message });
                        setBackupImportConfirmation({ isOpen: false, file: null, info: null });
                    } finally {
                        setBackupImportLoading(false);
                    }
                }}
                onCancel={() => setBackupImportConfirmation({ isOpen: false, file: null, info: null })}
            />

            <ConfirmModal
                isOpen={backupImportSuccess}
                title="Backup Imported"
                message="Backup imported successfully."
                confirmText="OK"
                showCancel={false}
                isDangerous={false}
                variant="success"
                onConfirm={() => setBackupImportSuccess(false)}
                onCancel={() => setBackupImportSuccess(false)}
            />

            <ConfirmModal
                isOpen={backupImportError.isOpen}
                title="Backup Import Failed"
                message={backupImportError.message}
                confirmText="OK"
                cancelText=""
                showCancel={false}
                isDangerous={false}
                onConfirm={() => setBackupImportError({ isOpen: false, message: '' })}
                onCancel={() => setBackupImportError({ isOpen: false, message: '' })}
            />
        </Layout >
    );
};
