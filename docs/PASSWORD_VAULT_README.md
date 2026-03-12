# Password Vault V1

## What Was Added

This implementation adds a web-first password vault to the existing Angular + Firebase app.

V1 includes:

- vault setup with a master password
- user-controlled recovery key generation
- per-session unlock and lock
- automatic lock on logout, page reload, browser unload, and route leave
- create, edit, delete, list, search, and copy for login credentials
- modal-based add/edit flow inside the vault page
- encrypted storage under `users/{uid}/vault/config` and `users/{uid}/vault/config/items/{itemId}`
- same-user Firestore access rules for user-owned data

V1 intentionally does not include:

- browser autofill
- browser extensions
- sharing
- cards, identities, attachments, or secure documents
- server-side secret decryption

## Why This Design

The vault follows the standard high-security pattern used by modern password managers:

- secrets are encrypted in the browser before upload
- the backend stores ciphertext and metadata only
- the master password is never stored server-side
- recovery is user-controlled through a recovery key instead of admin escrow

This keeps the trust boundary narrow and prevents the existing AI and retrieval stack from ever seeing plaintext vault contents.

## Security Model

### Encryption

- Sensitive fields are encrypted client-side.
- Item encryption uses `AES-256-GCM` through the browser Web Crypto API.
- Each encryption operation uses a fresh random IV.

### Key management

- A random 32-byte vault key is generated per user.
- The vault key is wrapped twice:
  - once with a key derived from the master password
  - once with a randomly generated recovery key

### Password derivation

- The master password is processed with `Argon2id`.
- The implementation uses `hash-wasm` for browser-safe Argon2id derivation.

### Recovery

- The recovery key is generated once during setup and shown to the user.
- It is not stored in plaintext.
- It can be used to unwrap the vault key and rotate the master-password wrap.

### Session handling

- The decrypted vault key is kept in memory only.
- It is cleared on logout.
- It is also cleared when the user leaves the vault route.
- Refreshing the app requires unlocking again.

## Storage Layout

### Firestore

- `users/{uid}/vault/config`
  - crypto version
  - Argon2id parameters and salt
  - vault key wrapped by password-derived key
  - vault key wrapped by recovery key
  - encrypted password verifier blob

- `users/{uid}/vault/config/items/{itemId}`
  - `type = login`
  - plaintext metadata: title, provider, favorite, tags
  - encrypted payload: username, password, url, notes
  - crypto version
  - timestamps

### Plaintext vs ciphertext

Plaintext metadata is limited to low-sensitivity search and list fields:

- title
- provider
- favorite
- tags

Encrypted fields:

- username
- password
- url
- notes

## Trust Boundaries

Plaintext vault contents are not sent to:

- Cloud Functions AI prompts
- the embedding service
- transcript intelligence flows
- persistent memory extraction

The current implementation keeps vault logic in a dedicated frontend crypto service and dedicated Firestore paths to preserve that boundary.

## Operational Notes

- The vault depends on browser crypto support.
- Losing both the master password and recovery key means the vault cannot be recovered.
- Search is metadata-only in V1.
- Firestore rules were tightened to same-user access for the user namespace.
- Vault access is available to any authenticated user. It is not founder-only.
- The current UI uses an in-page modal for add/edit, a searchable list view, and per-item reveal/copy actions.

## Local Testing

1. Run the frontend normally.
2. Log in with any authenticated account.
3. Open `Dashboard -> Password Vault`.
4. Create a vault with a master password.
5. Save the recovery key shown by the app.
6. Add a few login items through the `+ Add Login` modal.
7. Search by title, provider, and tags.
8. Navigate away from `/vault` or refresh the page and confirm the vault auto-locks.
9. Unlock again with the master password.
10. Test recovery using the recovery key and a new master password.
11. Inspect Firestore and confirm secret fields are stored as ciphertext blobs, not plaintext.

## Why `hash-wasm` Instead of `libsodium`

The original plan preferred `libsodium` or an equivalent audited browser-safe crypto package.

This implementation uses:

- `hash-wasm` for Argon2id
- browser Web Crypto for AES-GCM

That keeps the implementation aligned with the existing Angular/browser runtime while still using standard, audited primitives and avoiding any server-side decryption path.

## Future Expansion

Possible next steps:

- password generator
- secure note item type
- stronger mobile UX around lock/unlock
- per-item re-encryption/version migration flow
- browser extension / autofill
- encrypted sharing workflows
