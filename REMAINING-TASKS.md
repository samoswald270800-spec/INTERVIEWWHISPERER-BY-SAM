# Remaining Tasks

## ✅ Completed
1. **Settings Emoji**: Fixed (🐢 left, ⚡ right)
2. **High Contrast Mode**: Removed
3. **Button Placement**: 
   - Logout → Top Right ✅
   - Settings → Bottom Left (FAB style) ✅
4. **Login Page**: Info panel restored, Easter egg on title click

## ⏳ Pending

### 1. Icon Updates (App.jsx)
Need to update button icons to match UI better:

**Logout Button** (line ~346):
```jsx
<svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
    <polyline points="16 17 21 12 16 7"></polyline>
    <line x1="21" y1="12" x2="9" y2="12"></line>
</svg>
```

**Settings Button** (line ~358): Use simpler gear icon or keep current

### 2. Admin Permissions System

Full implementation needed:

#### Backend (server.js):
1. Update `/admin/api/users` POST to accept permissions:
```javascript
{
  username,
  password,
  hours,
  permissions: { canExpand: true, canAnalyze: true }
}
```

2. Store permissions in Redis with tempuser
3. Add middleware to check permissions before:
   - `/analyze-screen` → check `canAnalyze`  
   - Expand feature (frontend check) → check `canExpand`

#### Admin UI (admin/src/App.jsx):
Add checkboxes in create user form:
```jsx
<label>
  <input type="checkbox" checked={canExpand} onChange={(e) => setCanExpand(e.target.checked)} />
  Can Expand Answers
</label>
<label>
  <input type="checkbox" checked={canAnalyze} onChange={(e) => setCanAnalyze(e.target.checked)} />
  Can Analyze Screen
</label>
```

#### Frontend (public/src/App.jsx):
1. Fetch permissions from session
2. Disable expand button if `!permissions.canExpand`
3. Disable analyze button if `!permissions.canAnalyze`

## Next Steps
1. Manually update icon SVGs in `public/src/App.jsx`
2. Implement full permissions system (backend → admin → frontend)
3. Test and deploy
