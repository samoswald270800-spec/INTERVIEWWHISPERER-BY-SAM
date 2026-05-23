/**
 * Super Admin Dashboard
 * Matches online version: expandable admin cards, nested users, feature locks, stats
 */

import React, { useState, useEffect, useCallback } from 'react';
import API_BASE_URL from '../config';
import useSocket from '../hooks/useSocket';
import RemoteControlPanel from './RemoteControlPanel';
import './SuperAdminDashboard.css';

const FEATURE_KEYS = [
    { key: 'canExpand', label: 'Expand' },
    { key: 'canAnalyze', label: 'Analyze' },
    { key: 'canReasoning', label: 'Reasoning' },
    { key: 'canTurbo', label: 'Turbo' },
    { key: 'canStartSession', label: 'Sessions' },
];

export default function SuperAdminDashboard() {
    const [stats, setStats] = useState({ totalAdmins: 0, totalUsers: 0, sessionsToday: 0, totalAdminCredits: 0 });
    const [admins, setAdmins] = useState([]);
    const [expandedAdmin, setExpandedAdmin] = useState(null);
    const [adminUsers, setAdminUsers] = useState({});
    const [expandedUsers, setExpandedUsers] = useState({});
    const [adminLocks, setAdminLocks] = useState({});
    const [userLocks, setUserLocks] = useState({});
    const [toast, setToast] = useState({ show: false, msg: '', err: false });

    // Create admin modal
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState({ name: '', username: '', password: '', credits: 100 });

    // Socket.IO for remote control
    const socket = useSocket();

    const showToast = (msg, err = false) => {
        setToast({ show: true, msg, err });
        setTimeout(() => setToast({ show: false, msg: '', err: false }), 2500);
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
            // Load locks for each user
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
            showToast('Status updated'); loadAll();
        } catch (_) { showToast('Failed', true); }
    };

    const forceLogout = async (type, id) => {
        if (!confirm(`Force logout this ${type.slice(0, -1)}?`)) return;
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

    const deleteAdmin = async (id) => {
        if (!confirm('DELETE this admin permanently? This will also remove all their users.')) return;
        try {
            const r = await fetch(`${API_BASE_URL}/api/super-admin/admins/${id}`, { method: 'DELETE', credentials: 'include' });
            if (!r.ok) throw 0;
            showToast('Admin deleted'); loadAll();
        } catch (_) { showToast('Delete failed', true); }
    };

    const deleteUser = async (id, adminId) => {
        if (!confirm('DELETE this user permanently?')) return;
        try {
            const r = await fetch(`${API_BASE_URL}/api/super-admin/users/${id}`, { method: 'DELETE', credentials: 'include' });
            if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Failed'); }
            showToast('User deleted');
            loadUsersForAdmin(adminId); loadStats();
        } catch (e) { showToast(e.message || 'Delete failed', true); }
    };

    const toggleFeatureLock = async (type, id, featureKey, currentlyLocked) => {
        try {
            const r = await fetch(`${API_BASE_URL}/api/super-admin/${type}/${id}/feature-locks`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                body: JSON.stringify({ locks: { [featureKey]: currentlyLocked ? true : false } }),
            });
            if (!r.ok) throw 0;
            showToast(currentlyLocked ? `${featureKey} unlocked` : `${featureKey} locked`);
            loadFeatureLocks(type, id);
        } catch (_) { showToast('Failed to update lock', true); }
    };

    const handleLogout = async () => {
        await fetch(`${API_BASE_URL}/api/logout`, { method: 'POST', credentials: 'include' });
        window.location.href = '/login';
    };

    return (
        <div className="sa-app">
            <div className="bg-mesh"></div>
            <div className="wrap">
                {/* Header */}
                <header>
                    <div className="hdr-left">
                        <h1>Super Admin</h1>
                        <p>Platform Control Center</p>
                    </div>
                    <div className="hdr-right">
                        <button className="btn btn-ghost" onClick={handleLogout}>Sign Out</button>
                        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ New Admin</button>
                    </div>
                </header>

                {/* Stats */}
                <section className="stats">
                    <div className="stat"><div className="stat-label">Total Admins</div><div className="stat-value">{stats.totalAdmins}</div></div>
                    <div className="stat"><div className="stat-label">Total Users</div><div className="stat-value">{stats.totalUsers}</div></div>
                    <div className="stat"><div className="stat-label">Sessions Today</div><div className="stat-value">{stats.sessionsToday}</div></div>
                    <div className="stat"><div className="stat-label">Credits Pool</div><div className="stat-value">{stats.totalAdminCredits}</div></div>
                </section>

                {/* Remote Control Panel */}
                <RemoteControlPanel
                    connected={socket.connected}
                    onlineUsers={socket.onlineUsers}
                    error={socket.error}
                    waitingConsent={socket.waitingConsent}
                    remoteSession={socket.remoteSession}
                    screenFrame={socket.screenFrame}
                    connectWithPasscode={socket.connectWithPasscode}
                    sendInputEvent={socket.sendInputEvent}
                    endSession={socket.endSession}
                />

                {/* Admins List */}
                <h2 className="section-title">Admins</h2>
                <div className="list">
                    {admins.length === 0 ? (
                        <div className="empty">No admins yet</div>
                    ) : admins.map(a => (
                        <div key={a.id} className={`admin-card ${expandedAdmin === a.id ? 'expanded' : ''}`}>
                            <div className="admin-header" onClick={() => toggleAdmin(a.id)}>
                                <div className="avatar">{(a.name || a.username || '?').slice(0, 2).toUpperCase()}</div>
                                <div className="admin-info">
                                    <div className="admin-name">{a.name || a.username}</div>
                                    <div className="meta">
                                        @{a.username} · {a.userCount || 0} users
                                        <span className={`pill ${a.status === 'active' ? 'active' : 'suspended'}`}>{a.status}</span>
                                        <span style={{ color: 'var(--accent)', marginLeft: 6, fontWeight: 600 }}>{a.credits || 0} cr</span>
                                    </div>
                                </div>
                                <svg className="expand-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                            </div>
                            <div className="users-panel">
                                {/* Admin Feature Locks */}
                                <div className="feature-locks">
                                    <div className="feature-locks-title">Feature Locks (Admin Level — cascades to all users)</div>
                                    {FEATURE_KEYS.map(f => {
                                        const isLocked = (adminLocks[a.id] || {})[f.key] === false;
                                        return (
                                            <button key={f.key} className={`lock-toggle ${isLocked ? 'locked' : 'unlocked'}`}
                                                onClick={e => { e.stopPropagation(); toggleFeatureLock('admins', a.id, f.key, isLocked); }}>
                                                {isLocked ? '🔒' : '🔓'} {f.label}
                                            </button>
                                        );
                                    })}
                                </div>
                                {/* Users under this admin */}
                                <div className="users-list">
                                    {!(adminUsers[a.id]) ? <div className="empty" style={{ padding: 20 }}>Loading...</div> :
                                        (adminUsers[a.id].length === 0 ? <div className="empty" style={{ padding: 20, fontSize: 12 }}>No users found</div> :
                                            adminUsers[a.id].map(u => (
                                                <div key={u.id} className={`user-card ${expandedUsers[u.id] ? 'expanded' : ''}`}>
                                                    <div className="user-header" onClick={() => toggleUser(u.id)}>
                                                        <div className="user-avatar">{(u.username || '?').slice(0, 2).toUpperCase()}</div>
                                                        <div>
                                                            <div style={{ fontWeight: 600, fontSize: 13 }}>{u.username}</div>
                                                            <div style={{ fontSize: 11, color: 'var(--text-sec)', marginTop: 2 }}>
                                                                <span className={`pill ${u.status === 'active' ? 'active' : 'suspended'}`} style={{ fontSize: 9, padding: '2px 6px' }}>{u.status}</span> · {u.credits || 0} cr
                                                            </div>
                                                        </div>
                                                        <div style={{ flex: 1 }}></div>
                                                        <svg className="expand-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                                    </div>
                                                    <div className="user-stats">
                                                        <div className="mini-stats">
                                                            <div className="ms-item"><div className="ms-val">{u.credits || 0}</div><div className="ms-lbl">Credits</div></div>
                                                            <div className="ms-item"><div className="ms-val">{u.sessionCount || 0}</div><div className="ms-lbl">Sessions</div></div>
                                                            <div className="ms-item"><div className="ms-val">{u.permissions?.canAnalyze ? 'Yes' : 'No'}</div><div className="ms-lbl">Can Analyze</div></div>
                                                        </div>
                                                        {/* User Feature Locks */}
                                                        <div className="feature-locks" style={{ padding: '12px 16px 0' }}>
                                                            <div className="feature-locks-title">User-Level Locks (overrides admin)</div>
                                                            {FEATURE_KEYS.map(f => {
                                                                const isLocked = (userLocks[u.id] || {})[f.key] === false;
                                                                return (
                                                                    <button key={f.key} className={`lock-toggle ${isLocked ? 'locked' : 'unlocked'}`}
                                                                        onClick={e => { e.stopPropagation(); toggleFeatureLock('users', u.id, f.key, isLocked); }}>
                                                                        {isLocked ? '🔒' : '🔓'} {f.label}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                        <div className="user-actions">
                                                            <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); toggleStatus('users', u.id, u.status); }}>{u.status === 'active' ? 'Suspend' : 'Activate'}</button>
                                                            <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); resetPassword('users', u.id); }}>Reset Pass</button>
                                                            <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); forceLogout('users', u.id); }}>Force Logout</button>
                                                            <button className="btn btn-sm btn-danger" onClick={e => { e.stopPropagation(); deleteUser(u.id, a.id); }}>Delete</button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                </div>
                                {/* Admin Actions */}
                                <div style={{ padding: '0 24px 24px', display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                    <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); addCredits(a.id); }}>Add Credits</button>
                                    <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); toggleStatus('admins', a.id, a.status); }}>{a.status === 'active' ? 'Suspend' : 'Activate'}</button>
                                    <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); resetPassword('admins', a.id); }}>Reset Pass</button>
                                    <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); forceLogout('admins', a.id); }}>Force Logout</button>
                                    <button className="btn btn-sm btn-danger" onClick={e => { e.stopPropagation(); deleteAdmin(a.id); }}>Delete</button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Create Admin Modal */}
            {showModal && (
                <div className="modal-backdrop" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <h3>Create Admin</h3>
                        <form onSubmit={handleCreateAdmin}>
                            <div className="field"><label>Business Name</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="Acme Corp" /></div>
                            <div className="field"><label>Username</label><input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} required placeholder="acme" /></div>
                            <div className="field"><label>Password</label><input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required placeholder="Strong password" /></div>
                            <div className="field"><label>Credits</label><input type="number" value={form.credits} onChange={e => setForm({ ...form, credits: +e.target.value || 0 })} /></div>
                            <div className="modal-actions">
                                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Create</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Toast */}
            <div className={`toast ${toast.show ? 'show' : ''}`} style={{ backgroundColor: toast.err ? '#330000' : '#333' }}>{toast.msg}</div>
        </div>
    );
}
