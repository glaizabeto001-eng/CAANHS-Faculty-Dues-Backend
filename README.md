# CAANHS FACULTY DUES — Backend v3 (v37 Central Bridge)

This backend is a **migration bridge for the existing v37 frontend**. It preserves the tested v37 UI/workflows while moving its shared data state behind an authenticated central API.

## Important
- v37 remains the golden frontend baseline.
- This bridge is not the final normalized production API yet.
- It stores the v37 state in PostgreSQL JSONB so multi-device synchronization can be tested without rebuilding the v37 UI.
- Server-side department scoping is enforced for Department Treasurers.
- Members are view-only.

## Setup
1. Create a PostgreSQL database.
2. Run the existing central schema from `CAANHS_Faculty_Dues_Central_Database_v1.sql`.
3. Run `schema.sql` (or let the server create `app_state`).
4. Create users in the `users` table with bcrypt password hashes.
5. Copy `.env.example` to `.env` and set DATABASE_URL, JWT_SECRET and CORS_ORIGIN.
6. `npm install`
7. `npm start`

## API
- `POST /api/auth/login`
- `POST /api/auth/change-password`
- `GET /api/me`
- `GET /api/health`
- `GET /api/state`
- `PUT /api/state`
- `GET /api/dashboard`

## Next migration
Once multi-device sync is proven, migrate v37's Members, Dues, Payments, Remittances and Receipts one module at a time from JSONB state to the normalized tables already designed for Dues Hub.
