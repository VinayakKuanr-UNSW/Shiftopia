# Operational Runbook

## Quick Reference

| Issue | First Check | Recovery |
|-------|-------------|----------|
| App won't load | Check `.env` vars | See "Missing Config" below |
| Auth not working | Supabase Dashboard | See "Auth Issues" below |
| Shifts not updating | Edge function logs | See "Lifecycle Issues" below |

## Common Incidents

### Missing Config

**Symptoms**: App crashes on load with `[FATAL] Missing required environment variable`

**Resolution**:
1. Check `.env` file exists in project root
2. Verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set
3. Restart dev server: `npm run dev`

### Auth Issues

**Symptoms**: Login fails, session not persisting

**Steps**:
1. Check Supabase Dashboard → Authentication → Users
2. Verify user exists and is not banned
3. Check browser console for auth errors
4. Clear localStorage: `localStorage.clear()`

### Lifecycle Issues

**Symptoms**: Shifts not auto-progressing to active/completed

**Steps**:
1. Check Edge Function logs in Supabase Dashboard
2. Verify function is deployed: `supabase functions list`
3. Check `shift_lifecycle_log` table for recent entries
4. Manually invoke: `supabase functions invoke shift-lifecycle-updater`

### Database Errors

**Symptoms**: Operations fail with Postgres errors

**Steps**:
1. Check Supabase Dashboard → Database → Logs
2. Look for RLS policy violations
3. Verify user has correct role in `profiles.system_role`

## Debug Playbook

### Tracing a Failed Action

1. Open browser DevTools → Console
2. Look for structured log entries (JSON format)
3. Note the `correlationId` if present
4. Check Network tab for failed requests
5. Cross-reference with Supabase logs

### Where to Look First

| Layer | Location |
|-------|----------|
| Frontend | Browser Console, React DevTools |
| Auth | Supabase Dashboard → Authentication |
| Database | Supabase Dashboard → Database → Logs |
| Edge Functions | Supabase Dashboard → Edge Functions → Logs |

## Contacts

| Role | Responsibility |
|------|----------------|
| On-call Engineer | First responder for incidents |
| Backend Lead | Database and Supabase issues |
| Frontend Lead | UI and React issues |
