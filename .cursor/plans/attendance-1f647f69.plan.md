<!-- 1f647f69-e250-4d96-b86f-5d37bff921e4 063580be-a19f-4d80-89e1-86025520e66c -->
# Restore Manager Dashboard Imports

1. Clean File Header

- Remove the stray `useState` declaration at the top of `src/components/dashboard/ManagerDashboard.tsx` so imports start at line one.

2. Validate Imports

- Confirm `useState` (and other hooks) remain properly imported from React after cleaning, ensuring no duplicate or missing imports remain.

3. Smoke Check

- Rebuild/reload to verify the runtime error is gone and the dashboard renders the new attendance cards correctly.

### To-dos

- [ ] Check Supabase `time_attendance` timestamp columns and sample data to confirm tz issue
- [ ] Create and apply migration to convert attendance columns to `timestamptz` and backfill existing rows
- [ ] Review `qrService` timestamp writes and adjust if needed after schema change
- [ ] Verify manager dashboard renders correct local times post-fix