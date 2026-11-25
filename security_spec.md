# Aerolog Firestore Security Specification

## 1. Access Control Invariants
1. **Default Deny**: Every unmatched Firestore path is explicitly denied (`allow read, write: if false`).
2. **Strict Single-Tenant Per-User Isolation**: All pilot data lives under `/users/{userId}` and its subcollections (`/flights/{flightId}`, `/aircraft/{aircraftId}`).
3. **Verified Email Identity Gate**: Every read and write requires an authenticated user whose UID equals `{userId}` AND whose `request.auth.token.email_verified == true`.
4. **Zero User Enumeration / PII Protection**: `allow list` on `/users/{userId}` is unconditionally `false`. No user can list other profiles or discover other pilots' emails.
5. **Master Gate Relational Sync**: Every single-document operation (`get`, `create`, `update`, `delete`) on `/users/{userId}/flights/{flightId}` and `/users/{userId}/aircraft/{aircraftId}` fetches the parent `/users/{userId}` document with `get(...)` and verifies `data.uid == request.auth.uid`.
6. **Secure List Queries**: `allow list` on `/flights` and `/aircraft` requires `isVerifiedOwner(userId)` AND `existing().ownerId == request.auth.uid` (no `get()`/`exists()` in list rules; client queries filter by `where('ownerId', '==', uid)`).
7. **Immutable Ownership & Timestamps**: `uid`, `ownerId`, and `createdAt` can never be reassigned or forged. `createdAt == request.time` on create; `updatedAt == request.time` on create and update.
8. **Strict Schema & Bounds**: Every document write is validated by a standalone `isValidUserProfile`, `isValidFlight`, or `isValidAircraft` helper enforcing exact allowed keys, types, string lengths, numeric ranges, bounded arrays (`marks.size() <= 50`), and path ID regex `^[a-zA-Z0-9_\-]+$`.

## 2. Adversarial "Dirty Dozen" Payloads (All MUST Be Denied)
1. **Unauthenticated Read/Write**: `request.auth == null` reading `/users/userA/flights/f1`.
2. **Unverified Email Account**: `request.auth.uid == 'userA'` with `email_verified == false` attempting to create `/users/userA`.
3. **Cross-User Direct Read**: `userB` attempting `get` on `/users/userA/flights/f1`.
4. **Cross-User Collection List**: `userB` attempting `list` on `/users/userA/flights` or `/users`.
5. **Cross-User Write / Deletion**: `userB` attempting `update` or `delete` on `/users/userA/flights/f1` or `/users/userA/aircraft/A-JET`.
6. **Ownership Spoofing on Create**: `userA` attempting to create `/users/userA/flights/f1` with `ownerId: 'userB'`.
7. **Ownership Hijack on Update**: `userA` attempting to change `ownerId` or `uid` or `createdAt` during an update.
8. **Shadow Field Injection**: `userA` injecting an undeclared field like `isAdmin: true` or `role: 'superadmin'` into `/users/userA` or `/users/userA/flights/f1`.
9. **Path ID Poisoning**: `userA` writing to `/users/userA/flights/../../../other` or a 200-char junk ID violating `^[a-zA-Z0-9_\-]+$`.
10. **Timestamp Spoofing**: `userA` setting `createdAt` or `updatedAt` to a client-chosen timestamp instead of `request.time`.
11. **Denial-of-Wallet Oversized Payload**: `userA` writing `remarks` > 1000 chars, `marks` list > 50 elements, or `totalMinutes: 999999`.
12. **Orphaned Subcollection Write**: Writing to `/users/userA/flights/f1` when parent `/users/userA` does not exist or its `uid` does not match `request.auth.uid`.
