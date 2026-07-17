# Backfill Firebase Users

This one-time local admin script creates missing `users/{uid}` Firestore docs and syncs Firebase Auth custom role claims.

It is dry-run by default. It only writes when `APPLY=true`.

## 1. Authenticate Locally

```bash
gcloud auth application-default login
gcloud config set project hi-coworking-plat
```

## 2. Find Admin UIDs

Find UIDs in Firebase Console -> Authentication -> Users.

Use `master` for top-level admins. Do not use `super_admin`.

## 3. Dry Run

```bash
MASTER_UIDS="uid1" ADMIN_UIDS="uid2" npm run backfill:users --workspace functions
```

or:

```bash
MASTER_UIDS="uid1" ADMIN_UIDS="uid2" node apps/functions/scripts/backfill-users.cjs
```

## 4. Apply

```bash
APPLY=true MASTER_UIDS="uid1" ADMIN_UIDS="uid2" npm run backfill:users --workspace functions
```

## 5. Refresh Claims

Users must sign out and sign back in before updated custom claims are reflected in their ID token.

## Behavior

- Missing docs are created with `uid`, `email`, `displayName`, `role`, `membershipStatus: "none"`, `createdAt`, and `updatedAt`.
- Existing docs preserve membership fields, billing fields, plans, and membership period subcollections.
- Existing doc roles are preserved unless the UID is in `MASTER_UIDS` or `ADMIN_UIDS`, or the existing role is missing/invalid.
- Existing custom claims are preserved, except `role` is updated to match the Firestore role.
