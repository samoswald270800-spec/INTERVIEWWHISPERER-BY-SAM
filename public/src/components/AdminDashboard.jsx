/**
 * Admin (Consultancy) Dashboard
 * Matches online version: user cards, permissions, stats, credit management
 */

import React, { useState, useEffect, useCallback } from 'react';
import API_BASE_URL from '../config';
import './AdminDashboard.css';

const FEATURE_KEYS = [
    { key: 'canExpand', label: 'Expand' },
    { key: 'canAnalyze', label: 'Analyze' },
    { key: 'canReasoning', label: 'Reasoning' },
    { key: 'canAutomatic', label: 'Automatic' },
    { key: 'canStartSession', label: 'Sessions' },
];

export default function AdminDashboard() {
    const [stats, setStats] = useState({ totalUsers: 0, activeUsers: 0, creditsUsedToday: 0, sessionsToday: 0, credits: 0 });
    const [users, setUsers] = useState([]);
    const [expandedUser, setExpandedUser] = useState(null);
    const [adminSALocks, setAdminSALocks] = useState({});
    const [toast, setToast] = useState({ show: false, msg: '', err: false });

    // Create user modal
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState({ username: '', password: '', credits: 15, canExpand: true, canAnalyze: true });

    const showToast = (msg, err = false) => {
        setToast({ show: true, msg, err });
        setTimeout(() => setToast({ show: false, msg: '', err: false }), 2500);
    };

    const loadAdminLocks = useCallback(async () => {
        try {
            const r = await fetch(`${API_BASE_URL}/api/me`, { credentials: 'include' });
            if (!r.ok) return;
            const d = await r.json();
            setAdminSALocks(d.lockedFeatures || {});
        } catch (_) {}
    }, []);

    const loadStats = useCallback(async () => {
        try {
            const r = await fetch(`${API_BASE_URL}/api/admin/stats`, { credentials: 'include' });
            if (!r.ok) return;
            const d = await r.json();
            setStats(d.stats || d);
        } catch (_) {}
    }, []);

    const loadUsers = useCallback(async () => {
        try {
            const r = await fetch(`${API_BASE_URL}/api/admin/users`, { credentials: 'include' });
            if (!r.ok) return;
            const d = await r.json();
            setUsers(d.users || []);
        } catch (_) {}
    }, []);

    const loadAll = useCallback(() => Promise.all([loadStats(), loadUsers()]), [loadStats, loadUsers]);

    useEffect(() => { loadAdminLocks().then(() => loadAll()); }, [loadAdminLocks, loadAll]);

    const handleCreateUser = async (e) => {
        e.preventDefault();
        try {
            const r = await fetch(`${API_BASE_URL}/api/admin/users`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                body: JSON.stringify({
                    username: form.username, password: form.password, credits: form.credits,
                    permissions: { canExpand: form.canExpand, canAnalyze: form.canAnalyze },
                }),
            });
            if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Failed'); }
            showToast('User created');
            setShowModal(false);
            setForm({ username: '', password: '', credits: 15, canExpand: true, canAnalyze: true });
            loadAll();
        } catch (err) { showToast(err.message || 'Failed', true); }
    };

    const addCredits = async (id) => {
        const a = prompt('Credits to add:');
        if (!a) return;
        try {
            const r = await fetch(`${API_BASE_URL}/api/admin/users/${id}/credits/assign`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                body: JSON.stringify({ amount: +a, description: 'Admin credit assignment' }),
            });
            if (!r.ok) throw 0;
            showToast('Credits added'); loadAll();
        } catch (_) { showToast('Failed', true); }
    };

    const toggleStatus = async (id, cur) => {
        try {
            const r = await fetch(`${API_BASE_URL}/api/admin/users/${id}/status`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                body: JSON.stringify({ status: cur === 'active' ? 'suspended' : 'active' }),
            });
            if (!r.ok) throw 0;
            showToast('Status updated'); loadAll();
        } catch (_) { showToast('Failed', true); }
    };

    const forceLogout = async (id) => {
        if (!confirm('Force logout this user?')) return;
        try {
            const r = await fetch(`${API_BASE_URL}/api/admin/users/${id}/force-logout`, { method: 'POST', credentials: 'include' });
            if (!r.ok) throw 0;
            showToast('User logged out');
        } catch (_) { showToast('Failed', true); }
    };

    const deleteUser = async (id) => {
        if (!confirm('DELETE this user permanently?')) return;
        try {
            const r = await fetch(`${API_BASE_URL}/api/admin/users/${id}`, { method: 'DELETE', credentials: 'include' });
            if (!r.ok) throw 0;
            showToast('User deleted'); loadAll();
        } catch (_) { showToast('Delete failed', true); }
    };

    const togglePerm = async (userId, featureKey, currentlyEnabled) => {
        try {
            const r = await fetch(`${API_BASE_URL}/api/admin/users/${userId}/permissions`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                body: JSON.stringify({ permissions: { [featureKey]: !currentlyEnabled } }),
            });
            if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Failed'); }
            showToast(currentlyEnabled ? `${featureKey} disabled` : `${featureKey} enabled`);
            loadUsers();
        } catch (e) { showToast(e.message || 'Failed to update', true); }
    };

    const handleLogout = async () => {
        await fetch(`${API_BASE_URL}/api/logout`, { method: 'POST', credentials: 'include' });
        window.location.href = '/login';
    };

    return (
        <div className="ad-app">
            <div className="bg-mesh"></div>
            <div className="wrap">
                {/* Header */}
                <header>
                    <div className="hdr-left">
                        <h1>Admin Dashboard</h1>
                        <p>Manage your users</p>
                    </div>
                    <div className="hdr-right">
                        <div className="credit-badge">Credits: <span>{stats.credits || 0}</span></div>
                        <button className="btn btn-ghost" onClick={handleLogout}>Sign Out</button>
                        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ New User</button>
                    </div>
                </header>

                {/* Stats */}
                <section className="stats">
                    <div className="stat"><div className="stat-label">Total Users</div><div className="stat-value">{stats.totalUsers}</div></div>
                    <div className="stat"><div className="stat-label">Active</div><div className="stat-value">{stats.activeUsers}</div></div>
                    <div className="stat"><div className="stat-label">Credits Used Today</div><div className="stat-value">{stats.creditsUsedToday}</div></div>
                    <div className="stat"><div className="stat-label">Sessions Today</div><div className="stat-value">{stats.sessionsToday}</div></div>
                </section>

                {/* Users List */}
                <h2 className="section-title">Your Users</h2>
                <div className="list">
                    {users.length === 0 ? (
                        <div className="empty">No users yet</div>
                    ) : users.map(u => (
                        <div key={u.id} className={`user-card ${expandedUser === u.id ? 'expanded' : ''}`}>
                            <div className="user-header" onClick={() => setExpandedUser(expandedUser === u.id ? null : u.id)}>
                                <div className="avatar">{(u.username || '?').slice(0, 2).toUpperCase()}</div>
                                <div className="user-info">
                                    <div className="user-name">{u.username}</div>
                                    <div className="meta">
                                        {u.sessionCount || 0} sessions
                                        <span className={`pill ${u.status === 'active' ? 'active' : 'suspended'}`}>{u.status}</span>
                                        · {u.credits || 0} cr
                                    </div>
                                </div>
                                <svg className="expand-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                            </div>
                            <div className="user-details">
                                <div className="details-content">
                                    <div className="stats-grid">
                                        <div className="mini-stat"><div className="mini-stat-val">{u.credits || 0}</div><div className="mini-stat-lbl">Credits</div></div>
                                        <div className="mini-stat"><div className="mini-stat-val">{u.sessionCount || 0}</div><div className="mini-stat-lbl">Sessions</div></div>
                                        <div className="mini-stat"><div className="mini-stat-val">{u.creditsUsed || 0}</div><div className="mini-stat-lbl">Used</div></div>
                                        <div className="mini-stat"><div className="mini-stat-val">{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : 'Never'}</div><div className="mini-stat-lbl">Last Login</div></div>
                                    </div>
                                    {/* Permission Toggles */}
                                    <div className="feature-toggles">
                                        <div className="feature-toggles-title">Permissions</div>
                                        {FEATURE_KEYS.map(f => {
                                            const perms = u.permissions || {};
                                            const isEnabled = perms[f.key] !== false;
                                            const isSALocked = adminSALocks[f.key] || (perms.superAdminLocks || {})[f.key] === false;
                                            const cls = isSALocked ? 'sa-locked' : (isEnabled ? 'enabled' : 'disabled');
                                            const title = isSALocked ? 'Locked by Super Admin' : (isEnabled ? 'Click to disable' : 'Click to enable');
                                            return (
                                                <button key={f.key} className={`perm-toggle ${cls}`} title={title}
                                                    onClick={isSALocked ? undefined : (e => { e.stopPropagation(); togglePerm(u.id, f.key, isEnabled); })}>
                                                    {isSALocked ? '🔒' : (isEnabled ? '✓' : '✕')} {f.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="actions">
                                        <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); addCredits(u.id); }}>Add Credits</button>
                                        <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); toggleStatus(u.id, u.status); }}>{u.status === 'active' ? 'Suspend' : 'Activate'}</button>
                                        <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); forceLogout(u.id); }}>Force Logout</button>
                                        <button className="btn btn-sm btn-danger" onClick={e => { e.stopPropagation(); deleteUser(u.id); }}>Delete</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Create User Modal */}
            {showModal && (
                <div className="modal-backdrop" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <h3>Create User</h3>
                        <form onSubmit={handleCreateUser}>
                            <div className="field"><label>Username</label><input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} required placeholder="candidate" /></div>
                            <div className="field"><label>Password</label><input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required placeholder="Strong password" /></div>
                            <div className="field"><label>Credits</label><input type="number" value={form.credits} onChange={e => setForm({ ...form, credits: +e.target.value || 0 })} /></div>
                            <div className="field">
                                <label>Permissions</label>
                                <div className="chk-row">
                                    <label><input type="checkbox" checked={form.canExpand} onChange={e => setForm({ ...form, canExpand: e.target.checked })} /> Can Expand</label>
                                    <label><input type="checkbox" checked={form.canAnalyze} onChange={e => setForm({ ...form, canAnalyze: e.target.checked })} /> Can Analyze</label>
                                </div>
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Create</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Toast */}
            <div className={`toast ${toast.show ? 'show' : ''}`} style={{ borderColor: toast.err ? '#FF453A' : '#64D2FF' }}>{toast.msg}</div>
        </div>
    );
}
