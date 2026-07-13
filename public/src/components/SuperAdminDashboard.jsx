/**
 * Superadmin dashboard (IW Console v8).
 * Stats, candidate camera, remote control, expandable admin cards with
 * cascading feature locks and per-user overrides. Destructive actions are
 * optimistic with an Undo toast instead of confirm() dialogs.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import API_BASE_URL from '../config';
import useSocket from '../hooks/useSocket';
import RemoteControlPanel from './RemoteControlPanel';
import CandidateCameraPanel, { CandidateCameraPanelView } from './CandidateCameraPanel';
import './SuperAdminDashboard.css';

const FEATURE_KEYS = [
    { key: 'canExpand', label: 'Expand' },
    { key: 'canAnalyze', label: 'Analyze' },
    { key: 'canReasoning', label: 'Reasoning' },
    { key: 'canTurbo', label: 'Turbo' },
    { key: 'canStartSession', label: 'Sessions' },
];

const UNDO_WINDOW_MS = 6000;

function monogram(name) {
    return (name || '?').slice(0, 2).toUpperCase();
}

function LockSwitches({ locks, onToggle }) {
    return FEATURE_KEYS.map((feature) => {
        const isLocked = (locks || {})[feature.key] === false;
        return (
            <button
                key={feature.key}
                className="iw-switch"
                role="switch"
                aria-checked={!isLocked}
                onClick={(e) => { e.stopPropagation(); onToggle(feature.key, isLocked); }}
            >
                <span className="iw-switch-track"><span className="iw-switch-knob" /></span>
                <span className="iw-switch-label">{feature.label}</span>
            </button>
        );
    });
}

export default function SuperAdminDashboard({ embedded = false, candidateCamera = null }) {
    const [stats, setStats] = useState({ totalAdmins: 0, totalUsers: 0, sessionsToday: 0, totalAdminCredits: 0 });
    const [admins, setAdmins] = useState([]);
    const [expandedAdmin, setExpandedAdmin] = useState(null);
    const [adminUsers, setAdminUsers] = useState({});
    const [expandedUsers, setExpandedUsers] = useState({});
    const [adminLocks, setAdminLocks] = useState({});
    const [userLocks, setUserLocks] = useState({});
    const [menuId, setMenuId] = useState(null);

    // Optimistic deletes: hidden ids + pending undo toast
    const [hidden, setHidden] = useState({}); // `${type}-${id}` -> true
    const [toast, setToast] = useState(null); // { msg, err, canUndo }
    const pendingRef = useRef(null); // { key, timer, commit }
    const toastTimerRef = useRef(null);

    // Create admin modal
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState({ name: '', username: '', password: '', credits: 100 });

    // Socket.IO for remote control
    const socket = useSocket();

    // Standalone page: override the interview UI's body overflow lock
    useEffect(() => {
        if (embedded) return undefined;
        document.body.style.overflow = 'auto';
        document.body.style.height = 'auto';
        return () => {
            document.body.style.overflow = '';
            document.body.style.height = '';
        };
    }, [embedded]);

    const showToast = (msg, err = false) => {
        clearTimeout(toastTimerRef.current);
        setToast({ msg, err, canUndo: false });
        toastTimerRef.current = setTimeout(() => setToast(null), 2500);
    };

    const loadStats = useCallback(async () => {
        try {
            const r = await fetch(`${API_BASE_URL}/api/super-admin/stats`, { credentials: 'include' });
            if (!r.ok) return;
            const d = await r.json();
            setStats(d.stats || d);
        } catch (_) {}
    }, []);

    const loadAdmins = useCallback(async () => {
        try {
            const r = await fetch(`${API_BASE_URL}/api/super-admin/admins`, { credentials: 'include' });
            if (!r.ok) return;
            const d = await r.json();
            setAdmins(d.admins || []);
        } catch (_) {}
    }, []);

    const loadAll = useCallback(() => Promise.all([loadStats(), loadAdmins()]), [loadStats, loadAdmins]);

    useEffect(() => { loadAll(); }, [loadAll]);

    const loadUsersForAdmin = async (adminId) => {
        try {
            const r = await fetch(`${API_BASE_URL}/api/super-admin/admins/${adminId}/users`, { credentials: 'include' });
            if (!r.ok) return;
            const d = await r.json();
            setAdminUsers(prev => ({ ...prev, [adminId]: d.users || [] }));
            (d.users || []).forEach(u => loadFeatureLocks('users', u.id));
        } catch (_) {}
    };

    const loadFeatureLocks = async (type, id) => {
        try {
            const r = await fetch(`${API_BASE_URL}/api/super-admin/${type}/${id}/feature-locks`, { credentials: 'include' });
            if (!r.ok) return;
            const d = await r.json();
            const setter = type === 'admins' ? setAdminLocks : setUserLocks;
            setter(prev => ({ ...prev, [id]: d.superAdminLocks || {} }));
        } catch (_) {}
    };

    const toggleAdmin = (id) => {
        if (expandedAdmin === id) {
            setExpandedAdmin(null);
        } else {
            setExpandedAdmin(id);
            loadUsersForAdmin(id);
            loadFeatureLocks('admins', id);
        }
    };

    const toggleUser = (userId) => {
        setExpandedUsers(prev => ({ ...prev, [userId]: !prev[userId] }));
    };

    const handleCreateAdmin = async (e) => {
        e.preventDefault();
        try {
            const r = await fetch(`${API_BASE_URL}/api/super-admin/admins`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                body: JSON.stringify(form),
            });
            if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Failed'); }
            showToast('Admin created');
            setShowModal(false);
            setForm({ name: '', username: '', password: '', credits: 100 });
            loadAll();
        } catch (err) { showToast(err.message || 'Failed', true); }
    };

    const addCredits = async (id) => {
        const a = prompt('Credits to add:');
        if (!a) return;
        try {
            const r = await fetch(`${API_BASE_URL}/api/super-admin/admins/${id}/credits`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                body: JSON.stringify({ amount: +a }),
            });
            if (!r.ok) throw 0;
            showToast('Credits added'); loadAll();
        } catch (_) { showToast('Failed', true); }
    };

    const toggleStatus = async (type, id, cur) => {
        try {
            const r = await fetch(`${API_BASE_URL}/api/super-admin/${type}/${id}/status`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                body: JSON.stringify({ status: cur === 'active' ? 'suspended' : 'active' }),
            });
            if (!r.ok) throw 0;
            showToast('Status updated');
            loadAdmins();
            if (type === 'users' && expandedAdmin) loadUsersForAdmin(expandedAdmin);
        } catch (_) { showToast('Failed', true); }
    };

    const forceLogout = async (type, id) => {
        try {
            const r = await fetch(`${API_BASE_URL}/api/super-admin/${type}/${id}/force-logout`, { method: 'POST', credentials: 'include' });
            if (!r.ok) throw 0;
            showToast('Logged out');
        } catch (_) { showToast('Failed', true); }
    };

    const resetPassword = async (type, id) => {
        const newPass = prompt(`Enter NEW password for this ${type.slice(0, -1)}:`);
        if (!newPass) return;
        try {
            const r = await fetch(`${API_BASE_URL}/api/super-admin/${type}/${id}/password`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                body: JSON.stringify({ password: newPass }),
            });
            if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Failed'); }
            showToast('Password updated');
        } catch (err) { showToast(err.message || 'Failed', true); }
    };

    // ── Optimistic delete + Undo toast ──
    const flushPendingDelete = useCallback(() => {
        const pending = pendingRef.current;
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingRef.current = null;
        pending.commit();
    }, []);

    useEffect(() => () => {
        // Commit any pending delete if the dashboard unmounts mid-undo-window
        flushPendingDelete();
        clearTimeout(toastTimerRef.current);
    }, [flushPendingDelete]);

    const optimisticDelete = (type, item, label, commitFn) => {
        flushPendingDelete();
        const key = `${type}-${item.id}`;
        setHidden(prev => ({ ...prev, [key]: true }));
        setMenuId(null);
        clearTimeout(toastTimerRef.current);
        setToast({ msg: `Deleted ${label}`, err: false, canUndo: true });

        const commit = async () => {
            const ok = await commitFn();
            if (!ok) {
                setHidden(prev => { const next = { ...prev }; delete next[key]; return next; });
                showToast('Delete failed', true);
            }
        };
        const timer = setTimeout(() => {
            pendingRef.current = null;
            setToast(current => (current && current.canUndo ? null : current));
            commit();
        }, UNDO_WINDOW_MS);
        pendingRef.current = { key, timer, commit };
    };

    const undoDelete = () => {
        const pending = pendingRef.current;
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingRef.current = null;
        setHidden(prev => { const next = { ...prev }; delete next[pending.key]; return next; });
        setToast(null);
    };

    const deleteAdmin = (admin) => {
        optimisticDelete('admins', admin, admin.name || admin.username, async () => {
            try {
                const r = await fetch(`${API_BASE_URL}/api/super-admin/admins/${admin.id}`, { method: 'DELETE', credentials: 'include' });
                if (!r.ok) return false;
                loadAll();
                return true;
            } catch (_) { return false; }
        });
    };

    const deleteUser = (user, adminId) => {
        optimisticDelete('users', user, user.username, async () => {
            try {
                const r = await fetch(`${API_BASE_URL}/api/super-admin/users/${user.id}`, { method: 'DELETE', credentials: 'include' });
                if (!r.ok) return false;
                loadUsersForAdmin(adminId);
                loadStats();
                return true;
            } catch (_) { return false; }
        });
    };

    // Optimistic lock toggle: flip locally, then sync
    const toggleFeatureLock = async (type, id, featureKey, currentlyLocked) => {
        const setter = type === 'admins' ? setAdminLocks : setUserLocks;
        setter(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [featureKey]: currentlyLocked } }));
        try {
            const r = await fetch(`${API_BASE_URL}/api/super-admin/${type}/${id}/feature-locks`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                body: JSON.stringify({ locks: { [featureKey]: currentlyLocked ? true : false } }),
            });
            if (!r.ok) throw 0;
        } catch (_) {
            showToast('Failed to update lock', true);
            loadFeatureLocks(type, id);
        }
    };

    const handleLogout = async () => {
        await fetch(`${API_BASE_URL}/api/logout`, { method: 'POST', credentials: 'include' });
        window.location.href = '/login';
    };

    // Esc closes menus
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') setMenuId(null); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // Click-away for context menus: close on any outside press and swallow
    // that click so it can't trigger the element underneath. (An overlay div
    // can't work here — the cards' backdrop-filter creates stacking contexts
    // that would trap the menus below it.)
    useEffect(() => {
        if (menuId === null) return undefined;
        let swallow = false;
        const onPointerDown = (e) => {
            if (e.target.closest('.iw-menu') || e.target.closest('.sadash-kebab')) return;
            swallow = true;
            setMenuId(null);
        };
        const onClick = (e) => {
            if (!swallow) return;
            swallow = false;
            e.stopPropagation();
            e.preventDefault();
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('click', onClick, true);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('click', onClick, true);
        };
    }, [menuId]);

    const hiddenUserCount = Object.keys(hidden).filter(k => k.startsWith('users-')).length;
    const hiddenAdminCount = Object.keys(hidden).filter(k => k.startsWith('admins-')).length;
    const totalUsers = Math.max(0, (stats.totalUsers || 0) - hiddenUserCount);
    const totalAdmins = Math.max(0, (stats.totalAdmins || 0) - hiddenAdminCount);
    const creditsPool = (stats.totalAdminCredits || 0).toLocaleString();
    const visibleAdmins = admins.filter(a => !hidden[`admins-${a.id}`]);

    return (
        <div className={`sadash ${embedded ? 'sadash-embedded' : ''}`}>
            <div className="sadash-scroll">
                <div className="sadash-column">
                    {/* Header bar */}
                    <div className="sadash-headerbar">
                        <span className="sadash-title">Platform control</span>
                        <span className="sadash-summary">
                            {totalAdmins} admins · {totalUsers} users · {creditsPool} cr pool
                        </span>
                        <div className="sadash-spacer" />
                        {!embedded && (
                            <button className="iw-ghost-btn" onClick={handleLogout}>Sign out</button>
                        )}
                        <button className="iw-primary-btn" onClick={() => setShowModal(true)}>New admin</button>
                    </div>

                    {/* Stats strip */}
                    <div className="sadash-stats">
                        <div className="sadash-stat">
                            <div className="sadash-stat-value">{totalAdmins}</div>
                            <div className="iw-eyebrow">Total admins</div>
                        </div>
                        <div className="sadash-stat">
                            <div className="sadash-stat-value">{totalUsers}</div>
                            <div className="iw-eyebrow">Total users</div>
                        </div>
                        <div className="sadash-stat">
                            <div className="sadash-stat-value">{stats.sessionsToday || 0}</div>
                            <div className="iw-eyebrow">Sessions today</div>
                        </div>
                        <div className="sadash-stat">
                            <div className="sadash-stat-value credits">{creditsPool}</div>
                            <div className="iw-eyebrow">Credits pool</div>
                        </div>
                    </div>

                    {/* Camera + remote control row */}
                    <div className="sadash-duo">
                        {candidateCamera
                            ? <CandidateCameraPanelView camera={candidateCamera} />
                            : <CandidateCameraPanel />}
                        <RemoteControlPanel
                            connected={socket.connected}
                            onlineUsers={socket.onlineUsers}
                            error={socket.error}
                            waitingConsent={socket.waitingConsent}
                            remoteSession={socket.remoteSession}
                            screenFrame={socket.screenFrame}
                            remoteStream={socket.remoteStream}
                            candidateMicStream={socket.candidateMicStream}
                            returnAudioEnabled={socket.returnAudioEnabled}
                            returnAudioReady={socket.returnAudioReady}
                            connectWithPasscode={socket.connectWithPasscode}
                            sendInputEvent={socket.sendInputEvent}
                            setReturnAudioEnabled={socket.setReturnAudioEnabled}
                            endSession={socket.endSession}
                        />
                    </div>

                    {/* Admins */}
                    <div className="sadash-section-head">
                        <span className="sadash-section-title">Admins</span>
                        <span className="sadash-section-note">feature locks cascade to every user under the admin</span>
                    </div>

                    {visibleAdmins.length === 0 ? (
                        <div className="sadash-empty">No admins yet</div>
                    ) : visibleAdmins.map((admin) => {
                        const isOpen = expandedAdmin === admin.id;
                        const adminMenuOpen = menuId === `admin-${admin.id}`;
                        const suspended = admin.status !== 'active';
                        const users = (adminUsers[admin.id] || null);
                        const visibleUsers = users ? users.filter(u => !hidden[`users-${u.id}`]) : null;
                        return (
                            <div className="sadash-admin-card" key={admin.id}>
                                <div
                                    className={`sadash-admin-head ${isOpen ? 'open' : ''}`}
                                    onClick={() => toggleAdmin(admin.id)}
                                >
                                    <span className="sadash-monogram">{monogram(admin.name || admin.username)}</span>
                                    <div className="sadash-admin-id">
                                        <div className="sadash-admin-name-row">
                                            <span className="sadash-admin-name">{admin.name || admin.username}</span>
                                            <span className="sadash-admin-username">@{admin.username}</span>
                                        </div>
                                        <div className="sadash-admin-sub">
                                            {admin.userCount || 0} users · {admin.sessionCount || 0} sessions
                                        </div>
                                    </div>
                                    <div className="sadash-spacer" />
                                    <span className="sadash-credits">{(admin.credits || 0).toLocaleString()} cr</span>
                                    <span className="sadash-status">
                                        <span className={`sadash-status-dot ${suspended ? 'suspended' : 'active'}`} />
                                        {suspended ? 'Suspended' : 'Active'}
                                    </span>
                                    <button
                                        className="sadash-kebab"
                                        title="Admin actions"
                                        onClick={(e) => { e.stopPropagation(); setMenuId(adminMenuOpen ? null : `admin-${admin.id}`); }}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                            <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
                                        </svg>
                                    </button>
                                    <svg
                                        className="sadash-chevron"
                                        style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                                        width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                    >
                                        <polyline points="6 9 12 15 18 9"></polyline>
                                    </svg>
                                    {adminMenuOpen && (
                                        <div className="iw-menu sadash-admin-menu" onClick={(e) => e.stopPropagation()}>
                                            <button className="iw-menu-item" onClick={() => { setMenuId(null); addCredits(admin.id); }}>Add credits</button>
                                            <button className="iw-menu-item" onClick={() => { setMenuId(null); resetPassword('admins', admin.id); }}>Reset admin password</button>
                                            <button className="iw-menu-item" onClick={() => { setMenuId(null); toggleStatus('admins', admin.id, admin.status); }}>
                                                {suspended ? 'Reactivate admin' : 'Suspend admin'}
                                            </button>
                                            <button className="iw-menu-item" onClick={() => { setMenuId(null); forceLogout('admins', admin.id); }}>Force logout</button>
                                            <div className="iw-menu-divider" />
                                            <button className="iw-menu-item danger" onClick={() => deleteAdmin(admin)}>Delete admin</button>
                                        </div>
                                    )}
                                </div>

                                {isOpen && (
                                    <div className="sadash-admin-body">
                                        <div className="sadash-locks-row">
                                            <span className="iw-eyebrow">Feature locks</span>
                                            <LockSwitches
                                                locks={adminLocks[admin.id]}
                                                onToggle={(key, locked) => toggleFeatureLock('admins', admin.id, key, locked)}
                                            />
                                        </div>

                                        <div className="sadash-users-table">
                                            {visibleUsers === null ? (
                                                <div className="sadash-users-note">Loading…</div>
                                            ) : visibleUsers.length === 0 ? (
                                                <div className="sadash-users-note">No users found</div>
                                            ) : visibleUsers.map((user) => {
                                                const userOpen = !!expandedUsers[user.id];
                                                const userMenuOpen = menuId === `user-${user.id}`;
                                                const userSuspended = user.status !== 'active';
                                                return (
                                                    <div className="sadash-user" key={user.id}>
                                                        <div className="sadash-user-row" onClick={() => toggleUser(user.id)}>
                                                            <span className="sadash-user-name">{user.username}</span>
                                                            <span className="sadash-user-status">
                                                                <span className={`sadash-status-dot ${userSuspended ? 'suspended' : 'active'}`} />
                                                                {userSuspended ? 'suspended' : 'active'}
                                                            </span>
                                                            <span className="sadash-user-credits">{user.credits || 0} cr</span>
                                                            <div className="sadash-spacer" />
                                                            <button
                                                                className="sadash-inline-action"
                                                                onClick={(e) => { e.stopPropagation(); toggleStatus('users', user.id, user.status); }}
                                                            >
                                                                {userSuspended ? 'Activate' : 'Suspend'}
                                                            </button>
                                                            <button
                                                                className="sadash-kebab"
                                                                title="More actions"
                                                                onClick={(e) => { e.stopPropagation(); setMenuId(userMenuOpen ? null : `user-${user.id}`); }}
                                                            >
                                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                                                    <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
                                                                </svg>
                                                            </button>
                                                            <svg
                                                                className="sadash-chevron small"
                                                                style={{ transform: userOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                                                                width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#52525E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                                            >
                                                                <polyline points="6 9 12 15 18 9"></polyline>
                                                            </svg>
                                                            {userMenuOpen && (
                                                                <div className="iw-menu sadash-user-menu" onClick={(e) => e.stopPropagation()}>
                                                                    <button className="iw-menu-item" onClick={() => { setMenuId(null); resetPassword('users', user.id); }}>Reset password</button>
                                                                    <button className="iw-menu-item" onClick={() => { setMenuId(null); forceLogout('users', user.id); }}>Force logout</button>
                                                                    <div className="iw-menu-divider" />
                                                                    <button className="iw-menu-item danger" onClick={() => deleteUser(user, admin.id)}>Delete user</button>
                                                                </div>
                                                            )}
                                                        </div>
                                                        {userOpen && (
                                                            <div className="sadash-user-locks">
                                                                <span className="iw-eyebrow">User locks · override admin</span>
                                                                <LockSwitches
                                                                    locks={userLocks[user.id]}
                                                                    onToggle={(key, locked) => toggleFeatureLock('users', user.id, key, locked)}
                                                                />
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Create admin modal */}
            {showModal && (
                <div className="sadash-modal-backdrop" onClick={() => setShowModal(false)}>
                    <div className="sadash-modal" onClick={e => e.stopPropagation()}>
                        <h3>Create admin</h3>
                        <form onSubmit={handleCreateAdmin}>
                            <div className="sadash-field">
                                <label>Business name</label>
                                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="Acme Corp" />
                            </div>
                            <div className="sadash-field">
                                <label>Username</label>
                                <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} required placeholder="acme" />
                            </div>
                            <div className="sadash-field">
                                <label>Password</label>
                                <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required placeholder="Strong password" />
                            </div>
                            <div className="sadash-field">
                                <label>Credits</label>
                                <input type="number" value={form.credits} onChange={e => setForm({ ...form, credits: +e.target.value || 0 })} />
                            </div>
                            <div className="sadash-modal-actions">
                                <button type="button" className="iw-ghost-btn" onClick={() => setShowModal(false)}>Cancel</button>
                                <button type="submit" className="iw-primary-btn">Create</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Undo / feedback toast */}
            {toast && (
                <div className={`sadash-toast ${toast.err ? 'err' : ''}`}>
                    <span>{toast.msg}</span>
                    {toast.canUndo && (
                        <button className="sadash-toast-undo" onClick={undoDelete}>Undo</button>
                    )}
                    <button className="sadash-toast-close" title="Dismiss" onClick={() => setToast(null)}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            )}
        </div>
    );
}
