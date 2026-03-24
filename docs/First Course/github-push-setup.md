# GitHub Push Access — Setup for Boaz

> **For:** Paul
> **Context:** Boaz needs to push spec documents to `paw2paw/HF` from his local machine via Claude Code. The commit is ready locally on branch `claude/festive-chebyshev` but git can't authenticate.

---

## The Problem

The remote is HTTPS:
```
origin  https://github.com/paw2paw/HF.git
```

Push fails with:
```
fatal: could not read Username for 'https://github.com': Device not configured
```

macOS Keychain credential helper is configured but has no stored credentials for this repo.

---

## Fix — Pick One Option

### Option A — Add Boaz as a Collaborator (simplest)

1. Go to **github.com/paw2paw/HF → Settings → Collaborators**
2. Add Boaz's GitHub username with **Write** access
3. On Boaz's Mac, `git push` will prompt browser authentication — macOS Keychain saves the token for future pushes

### Option B — Personal Access Token (PAT)

1. Generate a PAT at **GitHub → Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens**
2. Scope it to the `paw2paw/HF` repo with **Contents: Read & Write** permission
3. Share it with Boaz securely
4. Boaz runs `git push`, enters the token as the password — macOS Keychain caches it

### Option C — Switch to SSH

1. Confirm Boaz's SSH public key is added to his GitHub account or the repo's deploy keys
2. Boaz changes the remote on his machine:
   ```bash
   git remote set-url origin git@github.com:paw2paw/HF.git
   ```
3. Push works without username/password prompts

---

## What's Already Done

The first spec document (`docs/first-course/first-course-spec.md`) is committed locally on branch `claude/festive-chebyshev`. Once auth is sorted, it's just:

```bash
git push origin claude/festive-chebyshev
```
