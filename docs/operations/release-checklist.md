# Release Checklist

## Pre-Deployment

- [ ] All tests passing locally
- [ ] `npm run build` succeeds without errors
- [ ] `npm run lint` passes
- [ ] Environment variables documented in `.env.example`
- [ ] No console.log statements in production code
- [ ] Feature flags disabled for unfinished work

## Migration Readiness

- [ ] Migrations tested locally: `supabase db reset`
- [ ] Rollback plan documented for destructive migrations
- [ ] Backup created before applying migrations
- [ ] RLS policies verified after migration

## Deployment

- [ ] Deploy to staging first
- [ ] Smoke test core workflows:
  - [ ] Login/logout
  - [ ] View shifts
  - [ ] Create/edit roster
  - [ ] Submit bid
- [ ] Monitor error rates for 15 minutes
- [ ] Deploy to production

## Post-Deployment

- [ ] Verify key pages load correctly
- [ ] Check Supabase Dashboard for errors
- [ ] Monitor application logs
- [ ] Announce deployment in team channel

## Rollback

If issues are detected:

1. Revert to previous deployment
2. If database migration applied:
   - Execute documented rollback script
   - Or restore from backup
3. Notify team of rollback
4. Create incident report
